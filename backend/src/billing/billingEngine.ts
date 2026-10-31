import crypto from 'crypto';
import { query, withTransaction, DbClient } from '../db/pool.js';
import { Money } from './money.js';
import { calculateBillingCycle, addPeriods, addDays, BillingPeriod } from './period.js';
import { discountEngine, LineForDiscount } from './discountEngine.js';
import { taxEngine } from './taxEngine.js';
import { eventBus } from '../common/events.js';
import { logger } from '../common/logger.js';

export interface BillingRunResult {
  runId: string;
  runDate: string;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  errorLogs: Array<{ subscriptionId: string; error: string }>;
  startedAt: Date;
  completedAt: Date;
}

export class BillingEngine {
  private formatInvoiceNumber(seq: number): string {
    return `INV-${String(seq).padStart(4, '0')}`;
  }

  async getNextInvoiceNumber(client?: DbClient): Promise<string> {
    try {
      const res = await query<{ nextval: string }>("SELECT nextval('invoice_number_seq')::text", [], client);
      const val = parseInt(res.rows[0]?.nextval || '1', 10);
      return this.formatInvoiceNumber(val);
    } catch (_err) {
      const countRes = await query<{ count: string }>('SELECT COUNT(*) as count FROM invoices', [], client);
      const val = parseInt(countRes.rows[0]?.count || '0', 10) + 1;
      return this.formatInvoiceNumber(val);
    }
  }

  /**
   * Core Billing Runner Algorithm
   * Safe for concurrent execution, idempotent, isolated per-subscription transactions.
   */
  async runBilling(asOfDate?: string): Promise<BillingRunResult> {
    const today = asOfDate || new Date().toISOString().slice(0, 10);
    const runId = crypto.randomUUID();
    const startedAt = new Date();

    // 1. Create billing_runs tracking row
    await query(
      `INSERT INTO billing_runs (id, run_date, status, started_at)
       VALUES ($1, $2, 'running', $3)`,
      [runId, today, startedAt]
    );

    logger.info({ runId, today }, 'Starting billing run');

    // 2. Discover due active subscriptions
    // Catch-up: next_billing_date <= today ensures any missed days are automatically billed!
    const dueRes = await query<{ id: string }>(
      `SELECT s.id 
       FROM subscriptions s
       WHERE s.status = 'active'
         AND s.next_billing_date IS NOT NULL
         AND s.next_billing_date <= $1::date
         AND (s.paused_until IS NULL OR s.paused_until < $1::date)
       ORDER BY s.next_billing_date ASC`,
      [today]
    );

    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const errorLogs: Array<{ subscriptionId: string; error: string }> = [];

    // 3. Process each subscription in an isolated transaction
    for (const row of dueRes.rows) {
      const subId = row.id;
      try {
        const result = await this.processSubscriptionBilling(subId, today);
        if (result.status === 'created') {
          createdCount++;
        } else if (result.status === 'skipped') {
          skippedCount++;
        }
      } catch (err: any) {
        failedCount++;
        const errMsg = err?.message || String(err);
        logger.error({ err, subscriptionId: subId }, 'Subscription billing failed in isolated transaction');
        errorLogs.push({ subscriptionId: subId, error: errMsg });
      }
    }

    const completedAt = new Date();

    // 4. Update billing_runs summary
    await query(
      `UPDATE billing_runs
       SET status = 'completed',
           created_count = $1,
           skipped_count = $2,
           failed_count = $3,
           error_logs = $4,
           completed_at = $5
       WHERE id = $6`,
      [createdCount, skippedCount, failedCount, JSON.stringify(errorLogs), completedAt, runId]
    );

    logger.info({ runId, createdCount, skippedCount, failedCount }, 'Billing run completed');

    return {
      runId,
      runDate: today,
      createdCount,
      skippedCount,
      failedCount,
      errorLogs,
      startedAt,
      completedAt
    };
  }

  /**
   * Process a single subscription within its own transaction boundary.
   */
  private async processSubscriptionBilling(
    subId: string,
    asOfDate: string
  ): Promise<{ status: 'created' | 'skipped'; invoiceId?: string }> {
    return withTransaction(async (client) => {
      // 1. Lock subscription row FOR UPDATE SKIP LOCKED (prevents concurrent double runs)
      const lockRes = await query<any>(
        `SELECT s.*, p.period, p.auto_close, p.price as plan_price
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.id = $1 AND s.status = 'active'
         FOR UPDATE SKIP LOCKED`,
        [subId],
        client
      );

      if (lockRes.rows.length === 0) {
        console.log('SKIPPED AT LOCKRES FOR SUB', subId);
        return { status: 'skipped' };
      }

      const sub = lockRes.rows[0];

      // Double-check paused_until inside transaction
      if (sub.paused_until && sub.paused_until >= asOfDate) {
        return { status: 'skipped' };
      }

      // 2. Count existing invoices for this subscription to get cycleIndex
      const cycleRes = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM invoices WHERE subscription_id = $1',
        [subId],
        client
      );
      const cycleIndex = parseInt(cycleRes.rows[0]?.count || '0', 10);

      // 3. Calculate period start and period end (anchor-based, month-end clamped, zero drift)
      const startDateStr = typeof sub.start_date === 'string' 
        ? sub.start_date.slice(0, 10) 
        : new Date(sub.start_date).toISOString().slice(0, 10);

      const { periodStart, periodEnd } = calculateBillingCycle(
        startDateStr,
        sub.period as BillingPeriod,
        cycleIndex
      );

      const invoiceId = crypto.randomUUID();
      const invoiceNumber = await this.getNextInvoiceNumber(client);
      const invoiceDate = asOfDate;
      const dueDate = addDays(invoiceDate, 14); // 14 days payment terms

      // 4. Fetch subscription lines with snapshot pricing
      const linesRes = await query<any>(
        `SELECT sl.*, pr.name as product_name
         FROM subscription_lines sl
         JOIN products pr ON pr.id = sl.product_id
         WHERE sl.subscription_id = $1`,
        [subId],
        client
      );

      const subLines = linesRes.rows;
      if (subLines.length === 0) {
        return { status: 'skipped' };
      }

      // 5. Calculate line gross amounts
      const linesForDiscount: LineForDiscount[] = subLines.map((l) => ({
        productId: l.product_id,
        quantity: l.quantity,
        grossCents: Money.toCents(l.unit_price) * l.quantity
      }));

      const subtotalCents = linesForDiscount.reduce((sum, l) => sum + l.grossCents, 0);
      const totalQuantity = linesForDiscount.reduce((sum, l) => sum + l.quantity, 0);
      const productIds = linesForDiscount.map((l) => l.productId);

      // 6. Find best eligible discount
      const eligibleDiscounts = await discountEngine.findEligibleDiscounts(
        invoiceDate,
        subtotalCents,
        totalQuantity,
        subId,
        productIds,
        client
      );

      const bestDiscount = discountEngine.evaluateBestDiscount(eligibleDiscounts, linesForDiscount);
      let appliedDiscountId: string | null = null;
      let totalDiscountCents = 0;
      let lineDiscountsCents: number[] = linesForDiscount.map(() => 0);

      if (bestDiscount) {
        // Atomically claim usage
        const claimed = await discountEngine.claimDiscountAtomic(bestDiscount.discountId, invoiceDate, client);
        if (claimed) {
          appliedDiscountId = bestDiscount.discountId;
          totalDiscountCents = bestDiscount.totalDiscountCents;
          lineDiscountsCents = bestDiscount.lineDiscountsCents;
        }
      }

      // 7. Resolve product taxes
      const taxRateMap = await taxEngine.getTaxRatesForProducts(productIds, client);

      // 8. Compute per-line: net = gross - discount; tax = round(net * rate/100); line_total = net + tax
      let totalTaxCents = 0;
      const computedInvoiceLines: any[] = [];

      for (let i = 0; i < subLines.length; i++) {
        const line = subLines[i];
        const grossCents = linesForDiscount[i]!.grossCents;
        const discountCents = lineDiscountsCents[i] || 0;
        const netCents = Math.max(0, grossCents - discountCents);

        const taxRateInfo = taxRateMap.get(line.product_id);
        const combinedTaxRate = taxRateInfo ? taxRateInfo.combinedTaxRate : 0;
        const taxCents = taxEngine.calculateLineTax(netCents, combinedTaxRate);
        const lineTotalCents = netCents + taxCents;

        totalTaxCents += taxCents;

        computedInvoiceLines.push({
          id: crypto.randomUUID(),
          invoice_id: invoiceId,
          product_id: line.product_id,
          variant_id: line.variant_id,
          description: line.product_name,
          quantity: line.quantity,
          unit_price: line.unit_price,
          tax_rate: combinedTaxRate,
          discount_amount: Money.toDecimal(discountCents),
          tax_amount: Money.toDecimal(taxCents),
          line_total: Money.toDecimal(lineTotalCents)
        });
      }

      const totalInvoiceCents = subtotalCents - totalDiscountCents + totalTaxCents;

      // 9. INSERT invoice ... ON CONFLICT ON CONSTRAINT uq_invoice_period DO NOTHING (IDEMPOTENCY!)
      const insertInvRes = await query<any>(
        `INSERT INTO invoices (
          id, invoice_number, subscription_id, customer_id, status,
          invoice_date, due_date, period_start, period_end,
          subtotal, discount_amount, tax_amount, total, amount_paid,
          applied_discount_id
        ) VALUES (
          $1, $2, $3, $4, 'draft',
          $5, $6, $7, $8,
          $9, $10, $11, $12, 0.00,
          $13
        ) ON CONFLICT (subscription_id, period_start, period_end) DO NOTHING
        RETURNING id`,
        [
          invoiceId,
          invoiceNumber,
          subId,
          sub.customer_id,
          invoiceDate,
          dueDate,
          periodStart,
          periodEnd,
          Money.toDecimal(subtotalCents),
          Money.toDecimal(totalDiscountCents),
          Money.toDecimal(totalTaxCents),
          Money.toDecimal(totalInvoiceCents),
          appliedDiscountId
        ],
        client
      );

      // If no row was inserted, constraint uq_invoice_period caught duplicate run -> skipped!
      if (insertInvRes.rows.length === 0) {
        if (appliedDiscountId) {
          // Release discount usage since invoice was skipped
          await discountEngine.releaseDiscount(appliedDiscountId, client);
        }
        return { status: 'skipped' };
      }

      // 10. Insert invoice lines
      for (const line of computedInvoiceLines) {
        await query(
          `INSERT INTO invoice_lines (
            id, invoice_id, product_id, variant_id, description,
            quantity, unit_price, tax_rate, discount_amount, tax_amount, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            line.id,
            line.invoice_id,
            line.product_id,
            line.variant_id,
            line.description,
            line.quantity,
            line.unit_price,
            line.tax_rate,
            line.discount_amount,
            line.tax_amount,
            line.line_total
          ],
          client
        );
      }

      // 11. Record discount redemption if applied
      if (appliedDiscountId) {
        const redemptionId = crypto.randomUUID();
        await query(
          `INSERT INTO discount_redemptions (id, discount_id, invoice_id, amount)
           VALUES ($1, $2, $3, $4)`,
          [redemptionId, appliedDiscountId, invoiceId, Money.toDecimal(totalDiscountCents)],
          client
        );
      }

      // 12. Advance next_billing_date to cycleIndex + 1
      const nextCycleStart = addPeriods(startDateStr, sub.period as BillingPeriod, cycleIndex + 1);
      let newStatus = sub.status;

      // Auto-close if past expiry and plan.auto_close = true
      if (sub.auto_close && sub.expiry_date && new Date(nextCycleStart) > new Date(sub.expiry_date)) {
        newStatus = 'closed';
      }

      await query(
        `UPDATE subscriptions
         SET next_billing_date = CASE WHEN $1 = 'closed' THEN NULL ELSE $2::date END,
             status = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [newStatus, nextCycleStart, subId],
        client
      );

      // 13. Write audit log & outbox event
      const auditId = crypto.randomUUID();
      await query(
        `INSERT INTO audit_log (id, action, entity, entity_id, after_state)
         VALUES ($1, 'invoice.created', 'invoices', $2, $3)`,
        [
          auditId,
          invoiceId,
          JSON.stringify({
            invoiceNumber,
            subscriptionId: subId,
            periodStart,
            periodEnd,
            total: Money.toDecimal(totalInvoiceCents)
          })
        ],
        client
      );

      // Record outbox event for email dispatcher
      const outboxId = crypto.randomUUID();
      await query(
        `INSERT INTO email_outbox (id, recipient, subject, body_text, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [
          outboxId,
          sub.customer_id,
          `Invoice ${invoiceNumber} Generated`,
          `Your invoice ${invoiceNumber} for period ${periodStart} to ${periodEnd} has been generated. Total: $${Money.toDecimal(totalInvoiceCents)}`
        ],
        client
      );

      // Real-time SSE dispatch
      eventBus.broadcast('invoice.created', {
        invoiceId,
        invoiceNumber,
        subscriptionId: subId,
        customerId: sub.customer_id,
        total: Money.toDecimal(totalInvoiceCents),
        periodStart,
        periodEnd
      });

      return { status: 'created', invoiceId };
    });
  }
}

export const billingEngine = new BillingEngine();
