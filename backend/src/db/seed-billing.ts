import { getPool, closePool } from './pool.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../common/logger.js';

export async function seedBillingData(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    logger.info('Starting billing demo data seed...');

    // 1. Fetch reference IDs
    const custRes = await client.query("SELECT id, name, email FROM customers WHERE email = 'customer@brightloop.io'");
    if (custRes.rows.length === 0) {
      throw new Error("Customer customer@brightloop.io not found! Run npm run seed first.");
    }
    const acmeCustomer = custRes.rows[0];

    const globexRes = await client.query("SELECT id, name, email FROM customers WHERE email = 'billing@globex.com'");
    const globexCustomer = globexRes.rows[0] || acmeCustomer;

    const planRes = await client.query("SELECT id, name, price, period FROM plans WHERE period = 'monthly' LIMIT 1");
    const proPlan = planRes.rows[0];
    if (!proPlan) throw new Error("Pro Monthly plan not found!");

    const annualPlanRes = await client.query("SELECT id, name, price, period FROM plans WHERE period = 'yearly' LIMIT 1");
    const annualPlan = annualPlanRes.rows[0] || proPlan;

    const prodRes = await client.query("SELECT id, name, base_price FROM products LIMIT 2");
    const cloudProduct = prodRes.rows[0];

    const varRes = await client.query("SELECT id, attribute, value, extra_price FROM product_variants LIMIT 1");
    const variant = varRes.rows[0] || null;

    // 2. Create Active Subscription for Acme Corporation
    const existingSub = await client.query(
      "SELECT id FROM subscriptions WHERE customer_id = $1 LIMIT 1",
      [acmeCustomer.id]
    );

    let sub1Id: string;
    if (existingSub.rows.length === 0) {
      sub1Id = uuidv4();
      await client.query(
        `INSERT INTO subscriptions (
          id, subscription_number, customer_id, plan_id, status,
          start_date, next_billing_date, notes
        ) VALUES ($1, 'SUB-0001', $2, $3, 'active', '2026-01-01', '2026-11-01', 'Primary Cloud Subscription for Acme Corp')`,
        [sub1Id, acmeCustomer.id, proPlan.id]
      );

      // Subscription line items
      const line1Id = uuidv4();
      const linePrice = parseFloat(cloudProduct.base_price) + (variant ? parseFloat(variant.extra_price) : 0);
      await client.query(
        `INSERT INTO subscription_lines (
          id, subscription_id, product_id, variant_id, unit_price, quantity
        ) VALUES ($1, $2, $3, $4, $5, 2)`,
        [line1Id, sub1Id, cloudProduct.id, variant?.id || null, linePrice]
      );
      logger.info('Created Acme Corp active subscription (SUB-0001)');
    } else {
      sub1Id = existingSub.rows[0].id;
      logger.info('Acme Corp subscription already exists');
    }

    // 3. Create Subscription for Globex
    const globexSubRes = await client.query(
      "SELECT id FROM subscriptions WHERE customer_id = $1 LIMIT 1",
      [globexCustomer.id]
    );
    let globexSubId: string;
    if (globexSubRes.rows.length === 0 && globexCustomer.id !== acmeCustomer.id) {
      globexSubId = uuidv4();
      await client.query(
        `INSERT INTO subscriptions (
          id, subscription_number, customer_id, plan_id, status,
          start_date, next_billing_date, notes
        ) VALUES ($1, 'SUB-0002', $2, $3, 'active', '2026-02-01', '2027-02-01', 'Enterprise SLA Annual Contract')`,
        [globexSubId, globexCustomer.id, annualPlan.id]
      );
      logger.info('Created Globex active subscription (SUB-0002)');
    } else {
      globexSubId = globexSubRes.rows[0]?.id || sub1Id;
    }

    // 4. Invoices for Acme Corp
    const existingInvs = await client.query(
      "SELECT id FROM invoices WHERE customer_id = $1",
      [acmeCustomer.id]
    );

    if (existingInvs.rows.length === 0) {
      // Invoice 1: Start as draft, add lines, then mark as paid
      const inv1Id = uuidv4();
      const inv1Subtotal = 128.00;
      const inv1Discount = 10.00;
      const inv1Tax = 9.74;
      const inv1Total = 127.74;

      await client.query(
        `INSERT INTO invoices (
          id, invoice_number, subscription_id, customer_id, status,
          invoice_date, due_date, period_start, period_end,
          subtotal, discount_amount, tax_amount, total, amount_paid, notes
        ) VALUES (
          $1, 'INV-0001', $2, $3, 'draft',
          '2026-09-01', '2026-09-15', '2026-09-01', '2026-09-30',
          $4, $5, $6, $7, 0.00, 'Monthly billing cycle September 2026'
        )`,
        [inv1Id, sub1Id, acmeCustomer.id, inv1Subtotal, inv1Discount, inv1Tax, inv1Total]
      );

      // Line items for Invoice 1
      await client.query(
        `INSERT INTO invoice_lines (
          id, invoice_id, product_id, variant_id, description,
          quantity, unit_price, tax_rate, discount_amount, tax_amount, line_total
        ) VALUES
        ($1, $2, $3, $4, 'Cloud Subscription Core (100 GB Fast SSD)', 2, 64.00, 8.25, 10.00, 9.74, 127.74)`,
        [uuidv4(), inv1Id, cloudProduct.id, variant?.id || null]
      );

      // Now transition Invoice 1 to paid
      await client.query(
        `UPDATE invoices SET status = 'paid', amount_paid = $1 WHERE id = $2`,
        [inv1Total, inv1Id]
      );

      // Recorded Payment for Invoice 1
      const pay1Id = uuidv4();
      await client.query(
        `INSERT INTO payments (
          id, invoice_id, amount, payment_method, payment_date, reference, notes
        ) VALUES (
          $1, $2, $3, 'credit_card', '2026-09-05', 'PAY-STRIPE-98234', 'Auto-charged corporate card ending in 4242'
        )`,
        [pay1Id, inv1Id, inv1Total]
      );
      logger.info('Created Invoice INV-0001 (paid) with recorded payment');

      // Invoice 2: Start as draft, add lines, then mark as confirmed
      const inv2Id = uuidv4();
      const inv2Subtotal = 128.00;
      const inv2Tax = 10.56;
      const inv2Total = 138.56;

      await client.query(
        `INSERT INTO invoices (
          id, invoice_number, subscription_id, customer_id, status,
          invoice_date, due_date, period_start, period_end,
          subtotal, discount_amount, tax_amount, total, amount_paid, notes
        ) VALUES (
          $1, 'INV-0002', $2, $3, 'draft',
          '2026-10-01', '2026-10-15', '2026-10-01', '2026-10-31',
          $4, 0.00, $5, $6, 0.00, 'Monthly billing cycle October 2026'
        )`,
        [inv2Id, sub1Id, acmeCustomer.id, inv2Subtotal, inv2Tax, inv2Total]
      );

      await client.query(
        `INSERT INTO invoice_lines (
          id, invoice_id, product_id, variant_id, description,
          quantity, unit_price, tax_rate, discount_amount, tax_amount, line_total
        ) VALUES
        ($1, $2, $3, $4, 'Cloud Subscription Core (100 GB Fast SSD)', 2, 64.00, 8.25, 0.00, 10.56, 138.56)`,
        [uuidv4(), inv2Id, cloudProduct.id, variant?.id || null]
      );

      // Transition Invoice 2 to confirmed
      await client.query(
        `UPDATE invoices SET status = 'confirmed' WHERE id = $1`,
        [inv2Id]
      );
      logger.info('Created Invoice INV-0002 (confirmed, awaiting payment)');

      // Invoice 3: DRAFT (Upcoming Month: November 2026)
      const inv3Id = uuidv4();
      await client.query(
        `INSERT INTO invoices (
          id, invoice_number, subscription_id, customer_id, status,
          invoice_date, due_date, period_start, period_end,
          subtotal, discount_amount, tax_amount, total, amount_paid, notes
        ) VALUES (
          $1, 'INV-0003', $2, $3, 'draft',
          '2026-11-01', '2026-11-15', '2026-11-01', '2026-11-30',
          128.00, 0.00, 10.56, 138.56, 0.00, 'Draft generation for November 2026'
        )`,
        [inv3Id, sub1Id, acmeCustomer.id]
      );

      await client.query(
        `INSERT INTO invoice_lines (
          id, invoice_id, product_id, variant_id, description,
          quantity, unit_price, tax_rate, discount_amount, tax_amount, line_total
        ) VALUES
        ($1, $2, $3, $4, 'Cloud Subscription Core (100 GB Fast SSD)', 2, 64.00, 8.25, 0.00, 10.56, 138.56)`,
        [uuidv4(), inv3Id, cloudProduct.id, variant?.id || null]
      );
      logger.info('Created Invoice INV-0003 (draft)');
    }

    // 5. Billing Runs Record
    const runRes = await client.query("SELECT id FROM billing_runs LIMIT 1");
    if (runRes.rows.length === 0) {
      await client.query(
        `INSERT INTO billing_runs (
          id, run_date, status, created_count, skipped_count, failed_count, error_logs
        ) VALUES (
          $1, '2026-10-01', 'completed', 2, 0, 0, '[]'::jsonb
        )`,
        [uuidv4()]
      );
      logger.info('Created billing run history record');
    }

    await client.query('COMMIT');
    logger.info('✅ Billing demo data seeded successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Failed to seed billing demo data');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed-billing.ts')) {
  seedBillingData()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await closePool();
      process.exit(1);
    });
}
