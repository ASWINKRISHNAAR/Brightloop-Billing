import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../common/authMiddleware.js';
import { billingEngine } from './billingEngine.js';
import { subscriptionService } from '../modules/subscriptions/subscription.service.js';
import { discountEngine } from './discountEngine.js';
import { query, withTransaction } from '../db/pool.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../common/errors.js';
import { authRepository } from '../modules/auth/auth.repository.js';
import { eventBus } from '../common/events.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { sendInvoiceConfirmedEmail, sendPaymentReceivedEmail } from '../common/emailNotifications.js';

export const billingRouter = Router();

billingRouter.use(requireAuth);

const runBillingSchema = z.object({
  asOfDate: z.string().optional()
});

// 1. Trigger Manual Billing Run (Admin & Staff)
billingRouter.post('/run', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = runBillingSchema.parse(req.body);
    const result = await billingEngine.runBilling(input.asOfDate);

    res.status(200).json({
      data: result,
      meta: { message: 'Billing run completed successfully' }
    });
  } catch (err) {
    next(err);
  }
});

// 2. List Billing Runs History (Admin & Staff)
billingRouter.get('/runs', requireRole('admin', 'staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const resList = await query(
      'SELECT * FROM billing_runs ORDER BY started_at DESC LIMIT 50'
    );
    res.status(200).json({ data: resList.rows, meta: { total: resList.rows.length } });
  } catch (err) {
    next(err);
  }
});

// 3. Get Billing Run Detail by ID (Admin & Staff)
billingRouter.get('/runs/:id', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const runRes = await query('SELECT * FROM billing_runs WHERE id = $1', [req.params['id']!]);
    if (runRes.rows.length === 0) {
      throw new NotFoundError('Billing run not found');
    }
    res.status(200).json({ data: runRes.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 4. Trigger Auto-Close of Expired Subscriptions (Admin & Staff)
billingRouter.post('/auto-close', requireRole('admin', 'staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const closedCount = await subscriptionService.autoCloseExpiredSubscriptions();
    res.status(200).json({
      closedCount,
      data: { closedCount },
      meta: { message: `Auto-closed ${closedCount} expired subscriptions.` }
    });
  } catch (err) {
    next(err);
  }
});

// 5. List Invoices (Admin, Staff, or Customer filtered)
billingRouter.get('/invoices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 20;
    const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;
    const search = req.query['search'] as string | undefined;
    const status = req.query['status'] as string | undefined;

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    // RBAC: Customer sees only their own invoices
    if (req.user!.role === 'customer') {
      conditions.push(`i.customer_id = $${idx}`);
      values.push(req.user!.customerId);
      idx++;
    } else if (req.query['customerId']) {
      conditions.push(`i.customer_id = $${idx}`);
      values.push(req.query['customerId']);
      idx++;
    }

    if (status && status.trim() !== '') {
      conditions.push(`i.status = $${idx}`);
      values.push(status.trim());
      idx++;
    }

    if (search && search.trim() !== '') {
      conditions.push(`(i.invoice_number ILIKE $${idx} OR c.name ILIKE $${idx} OR c.email ILIKE $${idx})`);
      values.push(`%${search.trim()}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*) as count 
      FROM invoices i 
      LEFT JOIN customers c ON c.id = i.customer_id 
      ${whereClause}
    `;
    const countRes = await query<{ count: string }>(countSql, values);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listSql = `
      SELECT 
        i.*,
        c.name as customer_name,
        c.email as customer_email,
        s.subscription_number
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      LEFT JOIN subscriptions s ON s.id = i.subscription_id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    values.push(limit, offset);

    const listRes = await query(listSql, values);
    res.status(200).json({ data: listRes.rows, total, meta: { total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

// 6. Get Invoice by ID (with Lines)
billingRouter.get('/invoices/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const invRes = await query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email, s.subscription_number
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN subscriptions s ON s.id = i.subscription_id
       WHERE i.id = $1`,
      [id]
    );

    if (invRes.rows.length === 0) {
      throw new NotFoundError('Invoice not found');
    }

    const invoice = invRes.rows[0];
    if (req.user!.role === 'customer' && invoice.customer_id !== req.user!.customerId) {
      throw new ForbiddenError('Access denied: You cannot view other customers invoices');
    }

    const linesRes = await query(
      `SELECT il.*, p.name as product_name
       FROM invoice_lines il
       LEFT JOIN products p ON p.id = il.product_id
       WHERE il.invoice_id = $1
       ORDER BY il.created_at ASC`,
      [id]
    );

    res.status(200).json({
      data: {
        ...invoice,
        lines: linesRes.rows
      }
    });
  } catch (err) {
    next(err);
  }
});

// 6b. Download Invoice as HTML (PDF-like)
billingRouter.get('/invoices/:id/pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;

    const invRes = await query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1`,
      [id]
    );

    if (invRes.rows.length === 0) {
      throw new NotFoundError('Invoice not found');
    }

    const invoice = invRes.rows[0];

    // RBAC: customers can only download their own invoices
    if (req.user!.role === 'customer' && req.user!.customerId !== invoice.customer_id) {
      throw new ForbiddenError('Access denied: You cannot download other customers\' invoices');
    }

    const linesRes = await query(
      `SELECT il.*, p.name as product_name
       FROM invoice_lines il
       LEFT JOIN products p ON p.id = il.product_id
       WHERE il.invoice_id = $1
       ORDER BY il.created_at ASC`,
      [id]
    );

    const lines = linesRes.rows;

    function fmt(val: number | string | undefined | null): string {
      const n = parseFloat(String(val ?? 0));
      return isNaN(n) ? '0.00' : n.toFixed(2);
    }

    function fmtDate(d: string | undefined | null): string {
      if (!d) return '—';
      try {
        return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch {
        return String(d);
      }
    }

    const subtotal = fmt(invoice.subtotal ?? invoice.total);
    const discount = fmt(invoice.discount_amount ?? 0);
    const tax = fmt(invoice.tax_amount ?? 0);
    const total = fmt(invoice.total);
    const amountPaid = fmt(invoice.amount_paid);
    const balanceDue = fmt(Math.max(0, parseFloat(String(invoice.total)) - parseFloat(String(invoice.amount_paid))));

    const linesHtml = lines.map((l: any) => `
      <tr>
        <td>${l.description || l.product_name || '—'}</td>
        <td style="text-align:center">${l.quantity ?? 1}</td>
        <td style="text-align:right">$${fmt(l.unit_price)}</td>
        <td style="text-align:right">$${fmt(l.total)}</td>
      </tr>`).join('');

    const statusColor = invoice.status === 'paid' ? '#38a169'
      : invoice.status === 'confirmed' ? '#e94560'
      : invoice.status === 'cancelled' ? '#718096'
      : '#d69e2e';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 40px 20px; }
    .page { max-width: 780px; margin: 0 auto; background: #16213e; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 48px rgba(0,0,0,0.6); }

    /* Header */
    .header { background: linear-gradient(135deg, #0f3460 0%, #533483 100%); padding: 40px 48px; display: flex; justify-content: space-between; align-items: flex-start; }
    .brand h1 { font-size: 28px; color: #e94560; letter-spacing: 2px; font-weight: 800; }
    .brand p { color: #a0aec0; font-size: 13px; margin-top: 4px; }
    .inv-meta { text-align: right; }
    .inv-meta .inv-number { font-size: 22px; font-weight: 700; color: #ffffff; }
    .inv-meta .inv-status { display: inline-block; margin-top: 6px; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: ${statusColor}; color: #fff; }

    /* Body */
    .body { padding: 40px 48px; }

    /* Info grid */
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px; }
    .info-card { background: #0f3460; border-radius: 10px; padding: 20px; }
    .info-card h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #a0aec0; margin-bottom: 12px; }
    .info-card p { font-size: 14px; color: #e0e0e0; line-height: 1.7; }
    .info-card .label { color: #718096; font-size: 12px; }

    /* Line items table */
    .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #a0aec0; margin-bottom: 12px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    thead tr { background: #0f3460; }
    th { padding: 12px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #a0aec0; font-weight: 600; }
    td { padding: 12px 14px; font-size: 14px; color: #e0e0e0; border-bottom: 1px solid #0f3460; }
    tbody tr:hover { background: rgba(15, 52, 96, 0.4); }
    tbody tr:last-child td { border-bottom: none; }

    /* Totals */
    .totals-wrapper { display: flex; justify-content: flex-end; margin-bottom: 32px; }
    .totals { background: #0f3460; border-radius: 10px; padding: 20px 28px; min-width: 320px; }
    .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .total-row .lbl { color: #a0aec0; }
    .total-row .val { color: #e0e0e0; font-weight: 500; }
    .divider { border: none; border-top: 1px solid #533483; margin: 10px 0; }
    .total-row.grand { font-size: 18px; font-weight: 800; }
    .total-row.grand .lbl { color: #e0e0e0; }
    .total-row.grand .val { color: #e94560; }
    .total-row.balance .val { color: ${parseFloat(balanceDue) > 0 ? '#e94560' : '#38a169'}; font-weight: 700; }

    /* Footer */
    .footer { background: #0f3460; padding: 24px 48px; display: flex; justify-content: space-between; align-items: center; }
    .footer p { font-size: 13px; color: #718096; }
    .footer .thank-you { font-size: 16px; color: #a0aec0; font-weight: 600; }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">
      <h1>⚡ BRIGHTLOOP</h1>
      <p>Billing &amp; Payments</p>
    </div>
    <div class="inv-meta">
      <div class="inv-number">${invoice.invoice_number}</div>
      <div class="inv-status">${invoice.status}</div>
    </div>
  </div>

  <div class="body">
    <div class="info-grid">
      <div class="info-card">
        <h3>Bill To</h3>
        <p><strong>${invoice.customer_name || '—'}</strong></p>
        <p>${invoice.customer_email || ''}</p>
      </div>
      <div class="info-card">
        <h3>Invoice Dates</h3>
        <p><span class="label">Invoice Date</span><br><strong>${fmtDate(invoice.invoice_date)}</strong></p>
        <p style="margin-top:8px"><span class="label">Due Date</span><br><strong>${fmtDate(invoice.due_date)}</strong></p>
      </div>
    </div>

    <p class="section-title">Line Items</p>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:center">Qty</th>
          <th style="text-align:right">Unit Price</th>
          <th style="text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml || `<tr><td colspan="4" style="text-align:center;color:#718096;padding:20px">No line items</td></tr>`}
      </tbody>
    </table>

    <div class="totals-wrapper">
      <div class="totals">
        <div class="total-row"><span class="lbl">Subtotal</span><span class="val">$${subtotal}</span></div>
        <div class="total-row"><span class="lbl">Discount</span><span class="val">−$${discount}</span></div>
        <div class="total-row"><span class="lbl">Tax</span><span class="val">$${tax}</span></div>
        <hr class="divider">
        <div class="total-row grand"><span class="lbl">Total</span><span class="val">$${total}</span></div>
        <hr class="divider">
        <div class="total-row"><span class="lbl">Amount Paid</span><span class="val">$${amountPaid}</span></div>
        <div class="total-row balance"><span class="lbl">Balance Due</span><span class="val">$${balanceDue}</span></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    <p class="thank-you">Thank you for your business 🙏</p>
  </div>
</div>
</body>
</html>`;

    const filename = `invoice-${invoice.invoice_number}.html`;
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// 7. Update Invoice Status (Admin & Staff)
billingRouter.patch('/invoices/:id/status', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const statusSchema = z.object({
      status: z.enum(['draft', 'confirmed', 'cancelled'])
    });
    const { status: targetStatus } = statusSchema.parse(req.body);

    const invRes = await query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invRes.rows.length === 0) {
      throw new NotFoundError('Invoice not found');
    }

    const current = invRes.rows[0];

    // Check valid transitions
    if (current.status === 'paid') {
      throw new ValidationError('Cannot change status of an already paid invoice');
    }
    if (current.status === 'cancelled') {
      throw new ValidationError('Cannot change status of a cancelled invoice');
    }

    // If cancelling, release any claimed discount
    if (targetStatus === 'cancelled' && current.applied_discount_id) {
      await discountEngine.releaseDiscount(current.applied_discount_id);
    }

    const updateRes = await query(
      `UPDATE invoices 
       SET status = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [targetStatus, id]
    );

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'invoice.status_changed',
      entity: 'invoices',
      entityId: id,
      beforeState: { status: current.status },
      afterState: { status: targetStatus }
    });

    eventBus.emit('invoice.status_changed', { invoiceId: id, status: targetStatus });

    // Fire-and-forget email notification when invoice is confirmed
    if (targetStatus === 'confirmed') {
      query('SELECT name, email FROM customers WHERE id = $1', [current.customer_id])
        .then((custRes) => {
          const cust = custRes.rows[0];
          if (cust?.email) {
            sendInvoiceConfirmedEmail(updateRes.rows[0], cust.email, cust.name || '').catch(() => {/* swallow */});
          }
        })
        .catch(() => {/* swallow */});
    }

    res.status(200).json({
      data: updateRes.rows[0],
      meta: { message: `Invoice status updated to ${targetStatus}` }
    });
  } catch (err) {
    next(err);
  }
});

// 8. List Payments (Admin, Staff, or Customer filtered)
billingRouter.get('/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 20;
    const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;
    const invoiceId = req.query['invoiceId'] as string | undefined;

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (req.user!.role === 'customer') {
      conditions.push(`i.customer_id = $${idx}`);
      values.push(req.user!.customerId);
      idx++;
    }

    if (invoiceId) {
      conditions.push(`p.invoice_id = $${idx}`);
      values.push(invoiceId);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*) as count 
      FROM payments p 
      JOIN invoices i ON i.id = p.invoice_id
      ${whereClause}
    `;
    const countRes = await query<{ count: string }>(countSql, values);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listSql = `
      SELECT 
        p.*,
        p.payment_date as recorded_at,
        p.payment_method as method,
        i.invoice_number,
        i.customer_id,
        c.name as customer_name
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      LEFT JOIN customers c ON c.id = i.customer_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    values.push(limit, offset);

    const listRes = await query(listSql, values);
    res.status(200).json({ data: listRes.rows, total, meta: { total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

// 9. Record Payment (Admin & Staff)
billingRouter.post('/payments', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const paymentSchema = z.object({
      invoice_id: z.string().min(1, 'Invoice ID is required'),
      amount: z.number().positive('Payment amount must be positive'),
      method: z.string().default('bank_transfer'),
      reference: z.string().optional(),
      recorded_at: z.string().optional(),
      notes: z.string().optional()
    });

    const input = paymentSchema.parse(req.body);

    const paymentResult = await withTransaction(async (client) => {
      // 1. Fetch invoice
      const invRes = await query<{
        id: string;
        invoice_number: string;
        customer_id: string;
        status: string;
        total: string;
        amount_paid: string;
      }>('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [input.invoice_id], client);

      if (invRes.rows.length === 0) {
        throw new NotFoundError('Invoice not found');
      }

      const inv = invRes.rows[0]!;
      if (inv.status === 'draft') {
        throw new ValidationError('Cannot record payments on draft invoices. Please confirm the invoice first.');
      }
      if (inv.status === 'cancelled') {
        throw new ValidationError('Cannot record payments on cancelled invoices.');
      }

      const total = parseFloat(inv.total);
      const currentPaid = parseFloat(inv.amount_paid);
      const remaining = Math.round((total - currentPaid) * 100) / 100;

      if (input.amount > remaining + 0.001) {
        throw new ValidationError(
          `Payment amount ($${input.amount.toFixed(2)}) exceeds outstanding balance ($${remaining.toFixed(2)})`
        );
      }

      // Map method to enum valid values: 'credit_card', 'bank_transfer', 'cash', 'stripe', 'paypal'
      const validMethods = ['credit_card', 'bank_transfer', 'cash', 'stripe', 'paypal'];
      const mappedMethod = validMethods.includes(input.method) ? input.method : 'bank_transfer';

      const paymentId = uuidv4();
      const paymentDate = input.recorded_at || new Date().toISOString().slice(0, 10);
      const reference = input.reference?.trim() || `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      // Insert payment
      const pRes = await query(
        `INSERT INTO payments (id, invoice_id, amount, payment_method, payment_date, reference, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [paymentId, inv.id, input.amount, mappedMethod, paymentDate, reference, input.notes || null],
        client
      );

      const newPaid = Math.round((currentPaid + input.amount) * 100) / 100;
      const newStatus = newPaid >= total ? 'paid' : inv.status;

      // Update invoice
      await query(
        `UPDATE invoices 
         SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [newPaid, newStatus, inv.id],
        client
      );

      return {
        payment: {
          ...pRes.rows[0],
          invoice_number: inv.invoice_number,
          recorded_at: paymentDate,
          method: mappedMethod
        },
        newPaid,
        newStatus
      };
    });

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'payment.recorded',
      entity: 'payments',
      entityId: paymentResult.payment.id,
      afterState: paymentResult.payment
    });

    eventBus.emit('payment.recorded', paymentResult.payment);

    // Fire-and-forget email notification after payment is recorded
    {
      // Re-fetch invoice to get latest amount_paid and customer info
      query('SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = $1', [paymentResult.payment.invoice_id])
        .then((invFetch) => {
          const updatedInv = invFetch.rows[0];
          if (updatedInv?.customer_email) {
            sendPaymentReceivedEmail(
              paymentResult.payment,
              updatedInv,
              updatedInv.customer_email,
              updatedInv.customer_name || ''
            ).catch(() => {/* swallow */});
          }
        })
        .catch(() => {/* swallow */});
    }

    res.status(201).json({
      data: paymentResult.payment,
      meta: { message: 'Payment recorded successfully' }
    });
  } catch (err) {
    next(err);
  }
});

// 10. Dashboard & Financial Reports Summary
billingRouter.get('/reports/summary', requireRole('admin', 'staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Active Subscriptions & MRR
    const subsRes = await query(`
      SELECT 
        COUNT(*) as active_subscriptions,
        COALESCE(SUM(
          CASE 
            WHEN p.period = 'monthly' THEN p.price
            WHEN p.period = 'yearly' THEN p.price / 12.0
            WHEN p.period = 'weekly' THEN p.price * 4.33
            WHEN p.period = 'daily' THEN p.price * 30.0
            ELSE p.price
          END
        ), 0) as mrr
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'active'
    `);

    // 2. Revenue collected & outstanding
    const revRes = await query(`
      SELECT 
        COALESCE(SUM(amount_paid), 0) as total_revenue_collected,
        COALESCE(SUM(CASE WHEN status = 'confirmed' THEN (total - amount_paid) ELSE 0 END), 0) as total_outstanding,
        COUNT(CASE WHEN status = 'confirmed' AND due_date < CURRENT_DATE AND (total - amount_paid) > 0 THEN 1 END) as overdue_count
      FROM invoices
      WHERE status IN ('confirmed', 'paid')
    `);

    // 3. Monthly revenue
    const monthlyRes = await query(`
      SELECT 
        TO_CHAR(invoice_date, 'YYYY-MM') as month,
        COUNT(id) as total_invoices,
        COALESCE(SUM(total), 0) as billed_revenue,
        COALESCE(SUM(amount_paid), 0) as collected_revenue,
        COALESCE(SUM(total - amount_paid), 0) as outstanding_revenue
      FROM invoices
      WHERE status IN ('confirmed', 'paid')
      GROUP BY TO_CHAR(invoice_date, 'YYYY-MM')
      ORDER BY month ASC
      LIMIT 12
    `);

    // 4. Overdue invoices
    const overdueRes = await query(`
      SELECT 
        i.id,
        i.invoice_number,
        i.subscription_id,
        i.customer_id,
        c.name as customer_name,
        c.email as customer_email,
        i.status,
        i.invoice_date,
        i.due_date,
        (CURRENT_DATE - i.due_date) as days_overdue,
        i.total,
        i.amount_paid,
        (i.total - i.amount_paid) as outstanding_amount
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.status = 'confirmed' 
        AND i.due_date < CURRENT_DATE 
        AND (i.total - i.amount_paid) > 0
      ORDER BY i.due_date ASC
      LIMIT 20
    `);

    res.status(200).json({
      data: {
        activeSubscriptions: parseInt(subsRes.rows[0]?.active_subscriptions || '0', 10),
        mrr: parseFloat(subsRes.rows[0]?.mrr || '0'),
        totalRevenueCollected: parseFloat(revRes.rows[0]?.total_revenue_collected || '0'),
        totalOutstanding: parseFloat(revRes.rows[0]?.total_outstanding || '0'),
        overdueCount: parseInt(revRes.rows[0]?.overdue_count || '0', 10),
        monthlyRevenue: monthlyRes.rows,
        overdueInvoices: overdueRes.rows
      }
    });
  } catch (err) {
    next(err);
  }
});
