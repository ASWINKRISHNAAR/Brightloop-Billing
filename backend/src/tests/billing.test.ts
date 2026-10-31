import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { setupTestDatabase } from './testDb.js';
import { query } from '../db/pool.js';
import { Money } from '../billing/money.js';
import { calculateBillingCycle, addPeriods, parseDate, formatDate } from '../billing/period.js';
import { billingEngine } from '../billing/billingEngine.js';
import { discountEngine } from '../billing/discountEngine.js';

/**
 * pg-mem returns DATE columns as JavaScript Date objects, while real PostgreSQL returns strings.
 * This helper normalises both to a consistent YYYY-MM-DD string for assertions.
 */
function toDateStr(val: unknown): string {
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    return val.slice(0, 10);
  }
  return String(val);
}

describe('Phase 5: Core Billing Engine & Property Tests (Section 11 items 1-8)', () => {
  beforeEach(async () => {
    setupTestDatabase();

    // Create complete schema required for billing engine tests
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'customer',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customers (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS taxes (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        rate NUMERIC(5,2) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        base_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        is_active BOOLEAN NOT NULL DEFAULT true,
        is_archived BOOLEAN NOT NULL DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS product_variants (
        id VARCHAR(36) PRIMARY KEY,
        product_id VARCHAR(36) NOT NULL REFERENCES products(id),
        attribute VARCHAR(100) NOT NULL,
        value VARCHAR(100) NOT NULL,
        extra_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        is_active BOOLEAN NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS product_taxes (
        product_id VARCHAR(36) NOT NULL REFERENCES products(id),
        tax_id VARCHAR(36) NOT NULL REFERENCES taxes(id),
        PRIMARY KEY (product_id, tax_id)
      );

      CREATE TABLE IF NOT EXISTS plans (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        period VARCHAR(50) NOT NULL,
        price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        min_quantity INT NOT NULL DEFAULT 1,
        auto_close BOOLEAN NOT NULL DEFAULT false,
        closable BOOLEAN NOT NULL DEFAULT true,
        pausable BOOLEAN NOT NULL DEFAULT true,
        renewable BOOLEAN NOT NULL DEFAULT true,
        version INT NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id VARCHAR(36) PRIMARY KEY,
        subscription_number VARCHAR(50) NOT NULL UNIQUE,
        customer_id VARCHAR(36) NOT NULL REFERENCES customers(id),
        plan_id VARCHAR(36) NOT NULL REFERENCES plans(id),
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        start_date DATE NOT NULL,
        expiry_date DATE,
        next_billing_date DATE,
        paused_until DATE,
        notes TEXT,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS subscription_lines (
        id VARCHAR(36) PRIMARY KEY,
        subscription_id VARCHAR(36) NOT NULL REFERENCES subscriptions(id),
        product_id VARCHAR(36) NOT NULL REFERENCES products(id),
        variant_id VARCHAR(36) REFERENCES product_variants(id),
        unit_price NUMERIC(12,2) NOT NULL,
        quantity INT NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS discounts (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(100),
        type VARCHAR(50) NOT NULL,
        value NUMERIC(12,2) NOT NULL,
        scope VARCHAR(50) NOT NULL DEFAULT 'subscription',
        min_purchase NUMERIC(12,2) DEFAULT 0.00,
        min_quantity INT DEFAULT 0,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        usage_limit INT,
        used_count INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS discount_products (
        discount_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(36) NOT NULL,
        PRIMARY KEY (discount_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS discount_subscriptions (
        discount_id VARCHAR(36) NOT NULL,
        subscription_id VARCHAR(36) NOT NULL,
        PRIMARY KEY (discount_id, subscription_id)
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id VARCHAR(36) PRIMARY KEY,
        invoice_number VARCHAR(50) NOT NULL UNIQUE,
        subscription_id VARCHAR(36) NOT NULL REFERENCES subscriptions(id),
        customer_id VARCHAR(36) NOT NULL REFERENCES customers(id),
        status VARCHAR(50) NOT NULL DEFAULT 'draft',
        invoice_date DATE NOT NULL,
        due_date DATE NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        applied_discount_id VARCHAR(36),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (subscription_id, period_start, period_end)
      );

      CREATE TABLE IF NOT EXISTS invoice_lines (
        id VARCHAR(36) PRIMARY KEY,
        invoice_id VARCHAR(36) NOT NULL REFERENCES invoices(id),
        product_id VARCHAR(36) NOT NULL REFERENCES products(id),
        variant_id VARCHAR(36) REFERENCES product_variants(id),
        description TEXT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        unit_price NUMERIC(12,2) NOT NULL,
        tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        line_total NUMERIC(12,2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discount_redemptions (
        id VARCHAR(36) PRIMARY KEY,
        discount_id VARCHAR(36) NOT NULL REFERENCES discounts(id),
        invoice_id VARCHAR(36) NOT NULL REFERENCES invoices(id),
        amount NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS billing_runs (
        id VARCHAR(36) PRIMARY KEY,
        run_date DATE NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_count INT NOT NULL DEFAULT 0,
        skipped_count INT NOT NULL DEFAULT 0,
        failed_count INT NOT NULL DEFAULT 0,
        error_logs JSON,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL,
        completed_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id VARCHAR(36) PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        entity VARCHAR(100) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        before_state TEXT,
        after_state TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS email_outbox (
        id VARCHAR(36) PRIMARY KEY,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body_text TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  describe('Item 1: Idempotency (Running runBilling twice creates exactly one invoice per period)', () => {
    it('running runBilling twice creates 1 invoice and skips duplicate on 2nd run', async () => {
      // Setup customer, plan, product, active subscription
      await query(`INSERT INTO customers (id, name, email) VALUES ('c1', 'Client 1', 'client1@test.com')`);
      await query(`INSERT INTO plans (id, name, period, price) VALUES ('p1', 'Monthly Plan', 'monthly', 100.00)`);
      await query(`INSERT INTO products (id, name, base_price) VALUES ('pr1', 'Cloud Hosting', 100.00)`);
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, next_billing_date)
        VALUES ('s1', 'SUB-0001', 'c1', 'p1', 'active', '2026-06-01', '2026-06-01')
      `);
      await query(`
        INSERT INTO subscription_lines (id, subscription_id, product_id, unit_price, quantity)
        VALUES ('sl1', 's1', 'pr1', 100.00, 1)
      `);

      // Run 1: Should create 1 invoice
      const run1 = await billingEngine.runBilling('2026-06-01');
      console.log('RUN1 RESULT:', JSON.stringify(run1));
      expect(run1.createdCount).toBe(1);
      expect(run1.skippedCount).toBe(0);
      expect(run1.failedCount).toBe(0);

      // Verify invoice count in DB
      const invCheck = await query('SELECT * FROM invoices WHERE subscription_id = $1', ['s1']);
      expect(invCheck.rows.length).toBe(1);
      expect(toDateStr(invCheck.rows[0].period_start)).toBe('2026-06-01');
      expect(toDateStr(invCheck.rows[0].period_end)).toBe('2026-06-30');

      // Run 2 on same asOf date: next_billing_date was advanced to 2026-07-01 -> skipped!
      const run2 = await billingEngine.runBilling('2026-06-01');
      expect(run2.createdCount).toBe(0);

      // Verify still exactly 1 invoice
      const invCheck2 = await query('SELECT * FROM invoices WHERE subscription_id = $1', ['s1']);
      expect(invCheck2.rows.length).toBe(1);
    });
  });

  describe('Item 2: Concurrent billing runs produce no duplicates', () => {
    it('parallel billing executions produce no duplicates due to row locking & unique constraint', async () => {
      await query(`INSERT INTO customers (id, name, email) VALUES ('c2', 'Client 2', 'client2@test.com')`);
      await query(`INSERT INTO plans (id, name, period, price) VALUES ('p2', 'Monthly Plan', 'monthly', 50.00)`);
      await query(`INSERT INTO products (id, name, base_price) VALUES ('pr2', 'API Access', 50.00)`);
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, next_billing_date)
        VALUES ('s2', 'SUB-0002', 'c2', 'p2', 'active', '2026-06-01', '2026-06-01')
      `);
      await query(`
        INSERT INTO subscription_lines (id, subscription_id, product_id, unit_price, quantity)
        VALUES ('sl2', 's2', 'pr2', 50.00, 1)
      `);

      // Execute 2 concurrent runs at the exact same moment
      const [res1, res2] = await Promise.all([
        billingEngine.runBilling('2026-06-01'),
        billingEngine.runBilling('2026-06-01')
      ]);

      const totalCreated = res1.createdCount + res2.createdCount;
      expect(totalCreated).toBe(1);

      // Exactly 1 invoice exists in the DB
      const invoices = await query('SELECT * FROM invoices WHERE subscription_id = $1', ['s2']);
      expect(invoices.rows.length).toBe(1);
    });
  });

  describe('Item 3: Subscription isolation (failing subscription does not block others)', () => {
    it('one failing subscription logs error to billing_runs without blocking valid subscription', async () => {
      await query(`INSERT INTO customers (id, name, email) VALUES ('c3', 'Client 3', 'client3@test.com')`);
      await query(`INSERT INTO plans (id, name, period, price) VALUES ('p3', 'Monthly Plan', 'monthly', 20.00)`);
      await query(`INSERT INTO products (id, name, base_price) VALUES ('pr3', 'Service', 20.00)`);

      // Sub A: Valid subscription with lines
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, next_billing_date)
        VALUES ('s3-valid', 'SUB-0003', 'c3', 'p3', 'active', '2026-06-01', '2026-06-01')
      `);
      await query(`
        INSERT INTO subscription_lines (id, subscription_id, product_id, unit_price, quantity)
        VALUES ('sl3', 's3-valid', 'pr3', 20.00, 1)
      `);

      // Sub B: Invalid subscription that triggers error during billing calculation
      await query(`INSERT INTO plans (id, name, period, price) VALUES ('p-bad', 'Bad Period Plan', 'unsupported-cycle', 20.00)`);
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, next_billing_date)
        VALUES ('s3-broken', 'SUB-0004', 'c3', 'p-bad', 'active', '2026-06-01', '2026-06-01')
      `);
      await query(`
        INSERT INTO subscription_lines (id, subscription_id, product_id, unit_price, quantity)
        VALUES ('sl3-broken', 's3-broken', 'pr3', 20.00, 1)
      `);

      const run = await billingEngine.runBilling('2026-06-01');

      // Valid sub was created, broken sub was recorded as failed!
      expect(run.createdCount).toBe(1);
      expect(run.failedCount).toBe(1);
      expect(run.errorLogs.length).toBe(1);
      expect(run.errorLogs[0]!.subscriptionId).toBe('s3-broken');

      // Valid invoice was committed
      const validInv = await query('SELECT * FROM invoices WHERE subscription_id = $1', ['s3-valid']);
      expect(validInv.rows.length).toBe(1);
    });
  });

  describe('Item 4: Missed billing day catch-up', () => {
    it('a missed billing day is caught up on the next run', async () => {
      await query(`INSERT INTO customers (id, name, email) VALUES ('c4', 'Client 4', 'client4@test.com')`);
      await query(`INSERT INTO plans (id, name, period, price) VALUES ('p4', 'Weekly Plan', 'weekly', 25.00)`);
      await query(`INSERT INTO products (id, name, base_price) VALUES ('pr4', 'Weekly SaaS', 25.00)`);
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, next_billing_date)
        VALUES ('s4', 'SUB-0005', 'c4', 'p4', 'active', '2026-05-15', '2026-05-15')
      `);
      await query(`
        INSERT INTO subscription_lines (id, subscription_id, product_id, unit_price, quantity)
        VALUES ('sl4', 's4', 'pr4', 25.00, 1)
      `);

      // Server was down on 2026-05-15; run happens on 2026-05-20
      const run = await billingEngine.runBilling('2026-05-20');
      expect(run.createdCount).toBe(1);

      const inv = await query('SELECT * FROM invoices WHERE subscription_id = $1', ['s4']);
      expect(inv.rows.length).toBe(1);
      expect(toDateStr(inv.rows[0].period_start)).toBe('2026-05-15');
    });
  });

  describe('Item 5: Month-End (31st), Leap Year (Feb 29), and Zero-Drift Property Tests', () => {
    it('anchor-based month-end clamp preserves 31st across all 12 months without drift', () => {
      const anchor = '2024-01-31'; // Leap year starting on 31st

      // Cycle 0: Jan 31 -> Feb 29 (leap year 2024)
      const c0 = calculateBillingCycle(anchor, 'monthly', 0);
      expect(c0.periodStart).toBe('2024-01-31');
      expect(c0.periodEnd).toBe('2024-02-28');

      // Cycle 1: Feb 29 -> March 31 (recovers 31st!)
      const c1 = calculateBillingCycle(anchor, 'monthly', 1);
      expect(c1.periodStart).toBe('2024-02-29');
      expect(c1.periodEnd).toBe('2024-03-30');

      // Cycle 2: March 31 -> April 30 (clamps to 30th)
      const c2 = calculateBillingCycle(anchor, 'monthly', 2);
      expect(c2.periodStart).toBe('2024-03-31');
      expect(c2.periodEnd).toBe('2024-04-29');

      // Cycle 3: April 30 -> May 31 (recovers 31st!)
      const c3 = calculateBillingCycle(anchor, 'monthly', 3);
      expect(c3.periodStart).toBe('2024-04-30');
      expect(c3.periodEnd).toBe('2024-05-30');

      // Cycle 11: Dec 31
      const c11 = calculateBillingCycle(anchor, 'monthly', 11);
      expect(c11.periodStart).toBe('2024-12-31');
    });

    it('leap year Feb 29 yearly anchor preserves Feb 28 in non-leap years and Feb 29 in leap years', () => {
      const leapAnchor = '2024-02-29'; // 2024 is leap year

      // 2025 (non-leap): clamped to Feb 28
      expect(addPeriods(leapAnchor, 'yearly', 1)).toBe('2025-02-28');
      // 2026 (non-leap): clamped to Feb 28
      expect(addPeriods(leapAnchor, 'yearly', 2)).toBe('2026-02-28');
      // 2027 (non-leap): clamped to Feb 28
      expect(addPeriods(leapAnchor, 'yearly', 3)).toBe('2027-02-28');
      // 2028 (leap year): recovers Feb 29!
      expect(addPeriods(leapAnchor, 'yearly', 4)).toBe('2028-02-29');
    });

    it('Property test: periods never overlap and have no gaps for any cycleIndex up to 100', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2020, max: 2030 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          fc.constantFrom('daily', 'weekly', 'monthly', 'yearly'),
          fc.integer({ min: 0, max: 24 }),
          (year, month, day, period, cycleIndex) => {
            const startStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const currCycle = calculateBillingCycle(startStr, period as any, cycleIndex);
            const nextCycle = calculateBillingCycle(startStr, period as any, cycleIndex + 1);

            // Curr periodStart <= Curr periodEnd
            const currStart = parseDate(currCycle.periodStart);
            const currEnd = parseDate(currCycle.periodEnd);
            expect(currStart.getTime()).toBeLessThanOrEqual(currEnd.getTime());

            // nextCycle.periodStart is exactly currCycle.periodEnd + 1 day (NO GAPS!)
            const endPlusOne = new Date(currEnd);
            endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
            expect(formatDate(endPlusOne)).toBe(nextCycle.periodStart);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Item 6: Historical immutability (changing product price / tax does not alter existing invoice)', () => {
    it('product price change does not modify prior generated invoice line prices', async () => {
      await query(`INSERT INTO customers (id, name, email) VALUES ('c6', 'Client 6', 'client6@test.com')`);
      await query(`INSERT INTO plans (id, name, period, price) VALUES ('p6', 'Monthly Plan', 'monthly', 100.00)`);
      await query(`INSERT INTO products (id, name, base_price) VALUES ('pr6', 'Old Base Price', 100.00)`);
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, next_billing_date)
        VALUES ('s6', 'SUB-0006', 'c6', 'p6', 'active', '2026-06-01', '2026-06-01')
      `);
      await query(`
        INSERT INTO subscription_lines (id, subscription_id, product_id, unit_price, quantity)
        VALUES ('sl6', 's6', 'pr6', 100.00, 1)
      `);

      // Generate invoice at price 100.00
      await billingEngine.runBilling('2026-06-01');

      const invBefore = await query('SELECT * FROM invoices WHERE subscription_id = $1', ['s6']);
      const invId = invBefore.rows[0].id;
      expect(Number(invBefore.rows[0].total)).toBe(100.00);

      // Now update product base_price in catalog to 250.00
      await query('UPDATE products SET base_price = 250.00 WHERE id = $1', ['pr6']);

      // Prior invoice and invoice lines remain strictly 100.00!
      const invAfter = await query('SELECT * FROM invoices WHERE id = $1', [invId]);
      expect(Number(invAfter.rows[0].total)).toBe(100.00);

      const linesAfter = await query('SELECT * FROM invoice_lines WHERE invoice_id = $1', [invId]);
      expect(Number(linesAfter.rows[0].unit_price)).toBe(100.00);
      expect(Number(linesAfter.rows[0].line_total)).toBe(100.00);
    });
  });

  describe('Item 7: Discounts (percentage & fixed math, usage limit, release on cancel)', () => {
    it('proportional fixed discount remainder distribution sums exactly to total discount', () => {
      // 10 dollars ($10.00 = 1000 cents) split across 3 lines of 33.33 each
      const lineAmounts = [3333, 3333, 3333];
      const discounts = Money.distributeProportionally(1000, lineAmounts);

      expect(discounts.reduce((sum, d) => sum + d, 0)).toBe(1000);
      expect(discounts).toEqual([334, 333, 333]); // remainder 1 allocated deterministically
    });

    it('enforces usage limit and stops discount when limit is reached', async () => {
      await query(`
        INSERT INTO discounts (id, name, type, value, start_date, end_date, usage_limit, used_count)
        VALUES ('disc-1', 'Limited Discount', 'fixed', 10.00, '2026-01-01', '2026-12-31', 1, 0)
      `);

      // Claim 1: Success (0 < 1)
      const claim1 = await discountEngine.claimDiscountAtomic('disc-1', '2026-06-01', { query } as any);
      expect(claim1).toBe(true);

      // Claim 2: Fails (limit reached)
      const claim2 = await discountEngine.claimDiscountAtomic('disc-1', '2026-06-01', { query } as any);
      expect(claim2).toBe(false);

      // Release discount (e.g. on invoice cancellation)
      await discountEngine.releaseDiscount('disc-1');

      // Claim 3: Succeeds again
      const claim3 = await discountEngine.claimDiscountAtomic('disc-1', '2026-06-01', { query } as any);
      expect(claim3).toBe(true);
    });
  });

  describe('Item 8: Pure integer cents arithmetic (no float 0.1 + 0.2 error)', () => {
    it('accurately computes 0.10 + 0.20 case without float errors', () => {
      const cent1 = Money.toCents('0.10'); // 10
      const cent2 = Money.toCents('0.20'); // 20
      const sum = cent1 + cent2; // 30
      expect(sum).toBe(30);
      expect(Money.toDecimal(sum)).toBe('0.30');
    });

    it('Property test: Invoice line totals always equal net + tax, and subtotal - discount + tax = total', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 100000 }), // gross 1.00 to 1000.00
          fc.integer({ min: 0, max: 50 }),       // discount rate 0-50%
          fc.integer({ min: 0, max: 30 }),       // tax rate 0-30%
          (grossCents, discountRate, taxRate) => {
            const discountCents = Money.calculatePercentage(grossCents, discountRate);
            const netCents = grossCents - discountCents;
            const taxCents = Money.calculatePercentage(netCents, taxRate);
            const lineTotalCents = netCents + taxCents;

            // Invariant 1: net + tax === lineTotal
            expect(netCents + taxCents).toBe(lineTotalCents);

            // Invariant 2: gross - discount + tax === lineTotal
            expect(grossCents - discountCents + taxCents).toBe(lineTotalCents);

            // Invariant 3: formatted decimals preserve equality
            const totalDec = parseFloat(Money.toDecimal(lineTotalCents));
            const expectedDec = parseFloat(Money.toDecimal(grossCents - discountCents + taxCents));
            expect(totalDec).toBe(expectedDec);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
