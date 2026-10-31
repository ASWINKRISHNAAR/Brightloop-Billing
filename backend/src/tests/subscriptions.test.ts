import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { setupTestDatabase } from './testDb.js';
import { query } from '../db/pool.js';
import jwt from 'jsonwebtoken';
import { config } from '../common/config.js';
import { subscriptionService } from '../modules/subscriptions/subscription.service.js';

describe('Phase 4: Subscription Lifecycle & State Machine Tests', () => {
  let app: any;
  let adminToken: string;
  let customerId: string;
  let planId: string;
  let nonClosablePlanId: string;
  let nonPausablePlanId: string;
  let productId: string;
  let variantId: string;

  beforeEach(async () => {
    setupTestDatabase();
    app = createApp();

    // Create required tables
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'customer',
        is_active BOOLEAN NOT NULL DEFAULT true,
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        failed_login_attempts INT NOT NULL DEFAULT 0,
        locked_until TIMESTAMP WITH TIME ZONE,
        last_login_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customers (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) UNIQUE REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        company VARCHAR(255),
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100) DEFAULT 'US',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS taxes (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        rate NUMERIC(5,2) NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        base_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        is_active BOOLEAN NOT NULL DEFAULT true,
        is_archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS product_variants (
        id VARCHAR(36) PRIMARY KEY,
        product_id VARCHAR(36) NOT NULL REFERENCES products(id),
        attribute VARCHAR(100) NOT NULL,
        value VARCHAR(100) NOT NULL,
        extra_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS product_taxes (
        product_id VARCHAR(36) NOT NULL REFERENCES products(id),
        tax_id VARCHAR(36) NOT NULL REFERENCES taxes(id),
        PRIMARY KEY (product_id, tax_id)
      );

      CREATE TABLE IF NOT EXISTS plans (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        period VARCHAR(50) NOT NULL,
        price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
        min_quantity INT NOT NULL DEFAULT 1,
        available_from DATE,
        available_to DATE,
        auto_close BOOLEAN NOT NULL DEFAULT false,
        closable BOOLEAN NOT NULL DEFAULT true,
        pausable BOOLEAN NOT NULL DEFAULT true,
        renewable BOOLEAN NOT NULL DEFAULT true,
        version INT NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS quotation_templates (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        plan_id VARCHAR(36) NOT NULL REFERENCES plans(id),
        validity_days INT NOT NULL DEFAULT 30,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS quotation_template_lines (
        id VARCHAR(36) PRIMARY KEY,
        template_id VARCHAR(36) NOT NULL REFERENCES quotation_templates(id),
        product_id VARCHAR(36) NOT NULL REFERENCES products(id),
        variant_id VARCHAR(36) REFERENCES product_variants(id),
        quantity INT NOT NULL DEFAULT 1
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
        quantity INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36),
        action VARCHAR(100) NOT NULL,
        entity VARCHAR(100) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        before_state TEXT,
        after_state TEXT,
        ip_address VARCHAR(50),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Setup Admin token
    const adminId = 'a0000000-0000-4000-8000-000000000001';
    await query(`INSERT INTO users (id, email, password_hash, name, role) VALUES ('${adminId}', 'admin@brightloop.io', 'hash', 'Admin', 'admin')`);
    adminToken = jwt.sign({ userId: adminId, email: 'admin@brightloop.io', role: 'admin' }, config.JWT_ACCESS_SECRET, { expiresIn: '1h' });

    // Setup Customer
    customerId = 'c0000000-0000-4000-8000-000000000101';
    await query(`INSERT INTO customers (id, name, email) VALUES ('${customerId}', 'Test Customer', 'test@cust.com')`);

    // Setup Standard Plan
    planId = 'b0000000-0000-4000-8000-000000000001';
    await query(`
      INSERT INTO plans (id, name, period, price, min_quantity, available_from, available_to, auto_close, closable, pausable, renewable)
      VALUES ('${planId}', 'Standard Plan', 'monthly', 50.00, 2, '2026-01-01', '2026-12-31', true, true, true, true)
    `);

    // Setup Non-Closable Plan
    nonClosablePlanId = 'b0000000-0000-4000-8000-000000000002';
    await query(`
      INSERT INTO plans (id, name, period, price, min_quantity, closable, pausable, renewable)
      VALUES ('${nonClosablePlanId}', 'Locked Contract', 'yearly', 1000.00, 1, false, true, true)
    `);

    // Setup Non-Pausable Plan
    nonPausablePlanId = 'b0000000-0000-4000-8000-000000000003';
    await query(`
      INSERT INTO plans (id, name, period, price, min_quantity, closable, pausable, renewable)
      VALUES ('${nonPausablePlanId}', 'Strict No Pause', 'monthly', 30.00, 1, true, false, true)
    `);

    // Setup Product & Variant
    productId = 'd0000000-0000-4000-8000-000000000001';
    await query(`INSERT INTO products (id, name, base_price) VALUES ('${productId}', 'CRM Base Seat', 40.00)`);

    variantId = 'e0000000-0000-4000-8000-000000000001';
    await query(`INSERT INTO product_variants (id, product_id, attribute, value, extra_price) VALUES ('${variantId}', '${productId}', 'Tier', 'Pro', 25.00)`);
  });

  describe('1. Subscription Creation & Snapshot Pricing', () => {
    it('creates subscription with snapshot pricing (base_price + extra_price = 65.00)', async () => {
      const res = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId,
          startDate: '2026-06-01',
          expiryDate: '2026-12-01',
          lines: [
            { productId, variantId, quantity: 2 } // total quantity = 2 matches plan min_quantity
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.subscription_number).toContain('SUB-');
      expect(res.body.data.lines.length).toBe(1);
      expect(Number(res.body.data.lines[0].unit_price)).toBe(65.00); // 40 base + 25 extra
      expect(res.body.data.lines[0].quantity).toBe(2);
    });

    it('creates subscription from quotation template with copied lines', async () => {
      // 1. Create Template
      const templateRes = await request(app)
        .post('/api/quotation-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Ready Bundle',
          planId,
          validityDays: 30,
          lines: [{ productId, variantId, quantity: 3 }]
        });
      const templateId = templateRes.body.data.id;

      // 2. Create Subscription from Template
      const res = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId,
          startDate: '2026-06-15',
          templateId
        });

      expect(res.status).toBe(201);
      expect(res.body.data.lines.length).toBe(1);
      expect(res.body.data.lines[0].quantity).toBe(3);
      expect(Number(res.body.data.lines[0].unit_price)).toBe(65.00);
    });

    it('enforces plan availability dates and min_quantity', async () => {
      // Date outside availability window
      const dateFail = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId,
          startDate: '2025-12-31', // before 2026-01-01
          lines: [{ productId, quantity: 2 }]
        });
      expect(dateFail.status).toBe(400);

      // Quantity below min_quantity (plan requires 2)
      const qtyFail = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId,
          startDate: '2026-06-01',
          lines: [{ productId, quantity: 1 }] // 1 < 2
        });
      expect(qtyFail.status).toBe(400);
    });
  });

  describe('2. State Machine Transitions and Side Effects', () => {
    it('executes full legal lifecycle: draft -> quotation -> confirmed -> active -> closed', async () => {
      const createRes = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId,
          startDate: '2026-07-01',
          lines: [{ productId, quantity: 2 }]
        });
      const subId = createRes.body.data.id;

      // 1. draft -> quotation
      const toQuotation = await request(app)
        .post(`/api/subscriptions/${subId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'quotation' });
      expect(toQuotation.status).toBe(200);
      expect(toQuotation.body.data.status).toBe('quotation');

      // 2. quotation -> confirmed
      const toConfirmed = await request(app)
        .post(`/api/subscriptions/${subId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'confirmed' });
      expect(toConfirmed.status).toBe(200);
      expect(toConfirmed.body.data.status).toBe('confirmed');

      // 3. confirmed -> active (side effect: next_billing_date = start_date)
      const toActive = await request(app)
        .post(`/api/subscriptions/${subId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'active' });
      expect(toActive.status).toBe(200);
      expect(toActive.body.data.status).toBe('active');
      expect(toActive.body.data.next_billing_date).toContain('2026-07-01');

      // 4. active -> closed (side effect: next_billing_date = null)
      const toClosed = await request(app)
        .post(`/api/subscriptions/${subId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'closed' });
      expect(toClosed.status).toBe(200);
      expect(toClosed.body.data.status).toBe('closed');
      expect(toClosed.body.data.next_billing_date).toBeNull();
    });

    it('rejects illegal state transitions with 422 UnprocessableEntity', async () => {
      const createRes = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId,
          startDate: '2026-07-01',
          lines: [{ productId, quantity: 2 }]
        });
      const subId = createRes.body.data.id;

      // Illegal: draft -> active directly
      const illegalJump = await request(app)
        .post(`/api/subscriptions/${subId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'active' });
      expect(illegalJump.status).toBe(422);
      expect(illegalJump.body.title).toBe('UnprocessableEntityError');
    });

    it('enforces plan closable=false constraint', async () => {
      // Create confirmed subscription on non-closable plan
      const createRes = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId: nonClosablePlanId,
          startDate: '2026-07-01',
          lines: [{ productId, quantity: 1 }]
        });
      const subId = createRes.body.data.id;

      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'quotation' });
      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'confirmed' });

      // Attempt to close early -> 403 Forbidden
      const closeAttempt = await request(app)
        .post(`/api/subscriptions/${subId}/transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'closed' });
      expect(closeAttempt.status).toBe(403);
      expect(closeAttempt.body.detail).toContain('non-closable');
    });
  });

  describe('3. Pause and Resume Operations', () => {
    it('pauses and resumes active subscription', async () => {
      const createRes = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId,
          startDate: '2026-08-01',
          lines: [{ productId, quantity: 2 }]
        });
      const subId = createRes.body.data.id;

      // Transition to active
      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'quotation' });
      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'confirmed' });
      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'active' });

      // Pause until 2026-09-01
      const pauseRes = await request(app)
        .post(`/api/subscriptions/${subId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pausedUntil: '2026-09-01' });
      expect(pauseRes.status).toBe(200);
      expect(pauseRes.body.data.paused_until).toContain('2026-09-01');

      // Resume
      const resumeRes = await request(app)
        .post(`/api/subscriptions/${subId}/resume`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.data.paused_until).toBeNull();
    });

    it('rejects pausing plan with pausable=false', async () => {
      const createRes = await request(app)
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId,
          planId: nonPausablePlanId,
          startDate: '2026-08-01',
          lines: [{ productId, quantity: 1 }]
        });
      const subId = createRes.body.data.id;

      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'quotation' });
      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'confirmed' });
      await request(app).post(`/api/subscriptions/${subId}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ to: 'active' });

      const pauseAttempt = await request(app)
        .post(`/api/subscriptions/${subId}/pause`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ pausedUntil: '2026-09-01' });
      expect(pauseAttempt.status).toBe(403);
    });
  });

  describe('4. Scheduled Auto-Close Job', () => {
    it('auto-closes expired active subscriptions where plan.auto_close = true', async () => {
      // Sub 1: Expired yesterday, auto_close = true
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, expiry_date, version)
        VALUES ('sub-exp-1', 'SUB-9991', '${customerId}', '${planId}', 'active', '2025-01-01', '2026-01-01', 1)
      `);

      // Sub 2: Not expired yet
      await query(`
        INSERT INTO subscriptions (id, subscription_number, customer_id, plan_id, status, start_date, expiry_date, version)
        VALUES ('sub-active-2', 'SUB-9992', '${customerId}', '${planId}', 'active', '2026-01-01', '2027-01-01', 1)
      `);

      const closed = await subscriptionService.autoCloseExpiredSubscriptions();
      expect(closed).toBe(1);

      const checkSub1 = await query('SELECT status FROM subscriptions WHERE id = $1', ['sub-exp-1']);
      expect(checkSub1.rows[0].status).toBe('closed');

      const checkSub2 = await query('SELECT status FROM subscriptions WHERE id = $1', ['sub-active-2']);
      expect(checkSub2.rows[0].status).toBe('active');
    });
  });
});
