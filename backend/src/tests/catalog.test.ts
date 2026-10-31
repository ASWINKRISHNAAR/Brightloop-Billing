import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { setupTestDatabase } from './testDb.js';
import { query } from '../db/pool.js';
import jwt from 'jsonwebtoken';
import { config } from '../common/config.js';

describe('Phase 3: Catalog, Taxes, Plans & Templates Tests', () => {
  let app: any;
  let adminToken: string;
  let staffToken: string;

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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (product_id, attribute, value)
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

    // Setup Admin and Staff tokens
    await query(`INSERT INTO users (id, email, password_hash, name, role) VALUES ('admin-1', 'admin@brightloop.io', 'hash', 'Admin', 'admin')`);
    adminToken = jwt.sign({ userId: 'admin-1', email: 'admin@brightloop.io', role: 'admin' }, config.JWT_ACCESS_SECRET, { expiresIn: '1h' });

    await query(`INSERT INTO users (id, email, password_hash, name, role) VALUES ('staff-1', 'staff@brightloop.io', 'hash', 'Staff', 'staff')`);
    staffToken = jwt.sign({ userId: 'staff-1', email: 'staff@brightloop.io', role: 'staff' }, config.JWT_ACCESS_SECRET, { expiresIn: '1h' });
  });

  describe('1. Tax Management', () => {
    it('Admin can create taxes; Staff can read but cannot create (403)', async () => {
      // Admin creates tax
      const res = await request(app)
        .post('/api/taxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Standard VAT',
          rate: 15.5,
          description: '15.5% Value Added Tax'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Standard VAT');
      expect(Number(res.body.data.rate)).toBe(15.5);

      // Staff reads taxes
      const listRes = await request(app)
        .get('/api/taxes')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);

      // Staff tries to create tax -> 403 Forbidden
      const staffCreate = await request(app)
        .post('/api/taxes')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Illegal Tax',
          rate: 10
        });
      expect(staffCreate.status).toBe(403);
    });

    it('Admin can update tax rule', async () => {
      const createRes = await request(app)
        .post('/api/taxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Initial Tax', rate: 10 });

      const taxId = createRes.body.data.id;

      const updateRes = await request(app)
        .patch(`/api/taxes/${taxId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rate: 12.5, isActive: false });

      expect(updateRes.status).toBe(200);
      expect(Number(updateRes.body.data.rate)).toBe(12.5);
      expect(updateRes.body.data.is_active).toBe(false);
    });
  });

  describe('2. Products & Variants Catalog', () => {
    it('Admin creates product with base_price and variant with extra_price', async () => {
      // 1. Create Tax
      const taxRes = await request(app)
        .post('/api/taxes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Sales Tax', rate: 8.25 });
      const taxId = taxRes.body.data.id;

      // 2. Create Product linked to tax
      const prodRes = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Brightloop CRM Subscription Base',
          description: 'Core CRM seat',
          basePrice: 50.00,
          taxIds: [taxId]
        });

      expect(prodRes.status).toBe(201);
      const productId = prodRes.body.data.id;
      expect(Number(prodRes.body.data.base_price)).toBe(50.00);

      // 3. Add Variant (e.g. Brand Odoo adds 560 extra price)
      const varRes = await request(app)
        .post(`/api/products/${productId}/variants`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          attribute: 'Brand',
          value: 'Odoo Edition',
          extraPrice: 560.00
        });

      expect(varRes.status).toBe(201);
      expect(varRes.body.data.attribute).toBe('Brand');
      expect(varRes.body.data.value).toBe('Odoo Edition');
      expect(Number(varRes.body.data.extra_price)).toBe(560.00);

      // 4. Fetch Product details (includes variants and taxes)
      const getProd = await request(app)
        .get(`/api/products/${productId}`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(getProd.status).toBe(200);
      expect(getProd.body.data.variants.length).toBe(1);
      expect(getProd.body.data.taxes.length).toBe(1);
    });

    it('rejects duplicate variant attribute-value pair on same product', async () => {
      const prodRes = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Product V', basePrice: 100 });
      const productId = prodRes.body.data.id;

      await request(app)
        .post(`/api/products/${productId}/variants`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ attribute: 'Color', value: 'Blue', extraPrice: 10 });

      const dupRes = await request(app)
        .post(`/api/products/${productId}/variants`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ attribute: 'Color', value: 'Blue', extraPrice: 15 });

      expect(dupRes.status).toBe(409);
    });

    it('archives product with soft delete', async () => {
      const prodRes = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Legacy Product', basePrice: 20 });
      const productId = prodRes.body.data.id;

      const archRes = await request(app)
        .post(`/api/products/${productId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(archRes.status).toBe(200);
      expect(archRes.body.data.is_archived).toBe(true);
      expect(archRes.body.data.is_active).toBe(false);

      // Excluded from default product list
      const list = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(list.body.data.some((p: any) => p.id === productId)).toBe(false);
    });
  });

  describe('3. Plans and Optimistic Locking', () => {
    it('creates plan with period, flags, and availability dates', async () => {
      const res = await request(app)
        .post('/api/plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Enterprise Annual Plan',
          period: 'yearly',
          price: 1200.00,
          minQuantity: 5,
          availableFrom: '2026-01-01',
          availableTo: '2026-12-31',
          autoClose: true,
          closable: false,
          pausable: true,
          renewable: true
        });

      expect(res.status).toBe(201);
      expect(res.body.data.period).toBe('yearly');
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.closable).toBe(false);
    });

    it('enforces optimistic locking on plan updates (increments version, rejects stale)', async () => {
      const planRes = await request(app)
        .post('/api/plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Concurrent Plan',
          period: 'monthly',
          price: 99.00
        });
      const planId = planRes.body.data.id;

      // Update with version 1 -> success, version becomes 2
      const update1 = await request(app)
        .patch(`/api/plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          version: 1,
          price: 109.00
        });
      expect(update1.status).toBe(200);
      expect(update1.body.data.version).toBe(2);
      expect(Number(update1.body.data.price)).toBe(109.00);

      // Update with stale version 1 -> 409 Conflict
      const staleUpdate = await request(app)
        .patch(`/api/plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          version: 1,
          price: 119.00
        });
      expect(staleUpdate.status).toBe(409);
      expect(staleUpdate.body.title).toBe('ConflictError');

      // Update with correct version 2 -> success
      const update2 = await request(app)
        .patch(`/api/plans/${planId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          version: 2,
          price: 119.00
        });
      expect(update2.status).toBe(200);
      expect(update2.body.data.version).toBe(3);
    });
  });

  describe('4. Quotation Templates', () => {
    it('creates, lists, and fetches quotation template with lines', async () => {
      // 1. Create plan
      const planRes = await request(app)
        .post('/api/plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Standard Monthly', period: 'monthly', price: 49.00 });
      const planId = planRes.body.data.id;

      // 2. Create product & variant
      const prodRes = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Core License', basePrice: 40.00 });
      const productId = prodRes.body.data.id;

      const varRes = await request(app)
        .post(`/api/products/${productId}/variants`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ attribute: 'Tier', value: 'Pro', extraPrice: 20.00 });
      const variantId = varRes.body.data.id;

      // 3. Create Quotation Template
      const templateRes = await request(app)
        .post('/api/quotation-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Pro Bundle Template',
          planId,
          validityDays: 15,
          lines: [
            { productId, variantId, quantity: 2 }
          ]
        });

      expect(templateRes.status).toBe(201);
      const templateId = templateRes.body.data.id;

      // 4. Fetch details
      const getRes = await request(app)
        .get(`/api/quotation-templates/${templateId}`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.name).toBe('Pro Bundle Template');
      expect(getRes.body.data.lines.length).toBe(1);
      expect(getRes.body.data.lines[0].quantity).toBe(2);
      expect(getRes.body.data.lines[0].product_name).toBe('Core License');
    });
  });
});
