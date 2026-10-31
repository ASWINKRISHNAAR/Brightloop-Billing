import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getPool, closePool } from './pool.js';
import { logger } from '../common/logger.js';

export async function seed(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    logger.info('Starting database seeding...');
    await client.query('BEGIN');

    // 1. Users
    const passwordHash = await bcrypt.hash('Admin@1234!', 10);

    const adminId = uuidv4();
    const staffId = uuidv4();
    const customerUserId = uuidv4();

    // Check existing
    const existing = await client.query('SELECT email FROM users WHERE email = $1', ['admin@brightloop.io']);
    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, 'admin', true, false),
                ($5, $6, $7, $8, 'staff', true, false),
                ($9, $10, $11, $12, 'customer', true, false)`,
        [
          adminId, 'admin@brightloop.io', passwordHash, 'System Administrator',
          staffId, 'staff@brightloop.io', passwordHash, 'Alex Billing Specialist',
          customerUserId, 'customer@brightloop.io', passwordHash, 'Acme Corp Admin'
        ]
      );
      logger.info('Created seed users (admin, staff, customer)');
    } else {
      await client.query(
        'UPDATE users SET password_hash = $1 WHERE email IN ($2, $3, $4)',
        [passwordHash, 'admin@brightloop.io', 'staff@brightloop.io', 'customer@brightloop.io']
      );
      logger.info('Updated seed passwords to Admin@1234!');
    }

    // 2. Customers
    const cust1Id = uuidv4();
    const cust2Id = uuidv4();

    const existingCust = await client.query('SELECT email FROM customers WHERE email = $1', ['customer@brightloop.io']);
    if (existingCust.rows.length === 0) {
      await client.query(
        `INSERT INTO customers (id, user_id, name, email, phone, company, address_line1, city, state, postal_code, country)
         VALUES ($1, $2, 'Acme Corporation', 'customer@brightloop.io', '+1 555-0199', 'Acme Corp', '100 Tech Way', 'San Francisco', 'CA', '94105', 'US'),
                ($3, null, 'Globex Enterprises', 'billing@globex.com', '+1 555-0244', 'Globex International', '250 Enterprise Blvd', 'Austin', 'TX', '78701', 'US')`,
        [cust1Id, customerUserId, cust2Id]
      );
      logger.info('Created seed customers');
    }

    // 3. Taxes
    const tax1Id = uuidv4();
    const tax2Id = uuidv4();
    const existingTaxes = await client.query('SELECT id FROM taxes LIMIT 1');
    if (existingTaxes.rows.length === 0) {
      await client.query(
        `INSERT INTO taxes (id, name, rate, description, is_active)
         VALUES ($1, 'Standard Sales Tax (8.25%)', 8.25, 'US State and Local Combined Tax', true),
                ($2, 'European VAT (20%)', 20.00, 'EU Standard Value Added Tax', true)`,
        [tax1Id, tax2Id]
      );
      logger.info('Created seed taxes');
    }

    // 4. Products & Variants
    const prod1Id = uuidv4();
    const prod2Id = uuidv4();
    const existingProds = await client.query('SELECT id FROM products LIMIT 1');
    if (existingProds.rows.length === 0) {
      await client.query(
        `INSERT INTO products (id, name, description, base_price, is_active)
         VALUES ($1, 'Cloud Subscription Core', 'Scalable multi-tenant cloud compute and database platform', 49.00, true),
                ($2, 'Dedicated SLA Support', '24/7 priority support with 15-minute response guarantee', 99.00, true)`,
        [prod1Id, prod2Id]
      );

      const var1Id = uuidv4();
      const var2Id = uuidv4();
      await client.query(
        `INSERT INTO product_variants (id, product_id, attribute, value, extra_price, is_active)
         VALUES ($1, $2, 'Storage', '100 GB Fast SSD', 15.00, true),
                ($3, $4, 'Storage', '500 GB NVMe', 50.00, true)`,
        [var1Id, prod1Id, var2Id, prod1Id]
      );

      logger.info('Created seed products and variants');
    }

    // 5. Plans
    const plan1Id = uuidv4();
    const plan2Id = uuidv4();
    const existingPlans = await client.query('SELECT id FROM plans LIMIT 1');
    if (existingPlans.rows.length === 0) {
      await client.query(
        `INSERT INTO plans (id, name, description, period, price, min_quantity, auto_close, closable, pausable, renewable, is_active)
         VALUES ($1, 'Pro Monthly', 'Full-featured monthly plan with automated recurring invoicing', 'monthly', 49.00, 1, false, true, true, true, true),
                ($2, 'Enterprise Annual', 'Discounted annual plan with priority SLA and phone support', 'yearly', 499.00, 1, false, true, true, true, true)`,
        [plan1Id, plan2Id]
      );
      logger.info('Created seed plans');
    }

    // 6. Discounts
    const disc1Id = uuidv4();
    const existingDisc = await client.query('SELECT id FROM discounts LIMIT 1');
    if (existingDisc.rows.length === 0) {
      await client.query(
        `INSERT INTO discounts (id, name, code, type, value, scope, min_purchase, start_date, end_date, usage_limit, used_count, is_active)
         VALUES ($1, 'Launch 10% Discount', 'LAUNCH10', 'percentage', 10.00, 'subscription', 0.00, '2026-01-01', '2026-12-31', 100, 1, true)`,
        [disc1Id]
      );
      logger.info('Created seed discounts');
    }

    await client.query('COMMIT');
    logger.info('Database seeded successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Database seeding failed');
    throw err;
  } finally {
    client.release();
  }
}

// Allow standalone execution via `tsx src/db/seed.ts`
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seed()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed execution error:', err);
      await closePool();
      process.exit(1);
    });
}
