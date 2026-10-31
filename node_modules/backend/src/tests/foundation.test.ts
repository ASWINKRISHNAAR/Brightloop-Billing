import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  TooManyRequestsError
} from '../common/errors.js';
import { eventBus } from '../common/events.js';
import fs from 'fs';
import path from 'path';

describe('Phase 1: Foundation & Infrastructure Tests', () => {
  const app = createApp();

  describe('1. Health and System Endpoints', () => {
    it('GET /health returns 200 with status UP', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'UP');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('GET /undefined-route returns 404 in RFC 9457 format', async () => {
      const res = await request(app).get('/non-existent-endpoint');
      expect(res.status).toBe(404);
      expect(res.body.type).toBe('https://brightloop.io/errors/not-found');
      expect(res.body.title).toBe('NotFoundError');
      expect(res.body.status).toBe(404);
      expect(res.body.detail).toContain('Endpoint GET /non-existent-endpoint not found');
      expect(res.body).toHaveProperty('requestId');
    });
  });

  describe('2. RFC 9457 Error Hierarchy', () => {
    it('correctly constructs ValidationError with field errors', () => {
      const err = new ValidationError('Invalid inputs', { email: ['Email is invalid'] });
      expect(err.statusCode).toBe(400);
      expect(err.type).toBe('https://brightloop.io/errors/validation-error');
      expect(err.fieldErrors).toEqual({ email: ['Email is invalid'] });
    });

    it('correctly constructs Unauthorized, Forbidden, Conflict, and Unprocessable errors', () => {
      const notFound = new NotFoundError('Custom not found');
      expect(notFound.statusCode).toBe(404);
      expect(notFound.type).toBe('https://brightloop.io/errors/not-found');

      const unauth = new UnauthorizedError();
      expect(unauth.statusCode).toBe(401);

      const forb = new ForbiddenError();
      expect(forb.statusCode).toBe(403);

      const conflict = new ConflictError('Version mismatch');
      expect(conflict.statusCode).toBe(409);

      const unproc = new UnprocessableEntityError('State transition invalid');
      expect(unproc.statusCode).toBe(422);

      const tooMany = new TooManyRequestsError();
      expect(tooMany.statusCode).toBe(429);
    });
  });

  describe('3. Real-Time Event Bus and SSE', () => {
    it('eventBus can broadcast and record client connections', () => {
      let received: any = null;
      eventBus.once('invoice.created', (payload) => {
        received = payload;
      });

      eventBus.broadcast('invoice.created', { invoiceId: 'inv-123', total: 5000 });
      expect(received).not.toBeNull();
      expect(received.type).toBe('invoice.created');
      expect(received.data.invoiceId).toBe('inv-123');
      expect(received.data.total).toBe(5000);
      expect(received).toHaveProperty('timestamp');
    });
  });

  describe('4. Database Migration Integrity', () => {
    it('migration file 001_init.sql exists and contains all required types and tables', () => {
      const migrationPath = path.resolve(__dirname, '../../../database/migrations/001_init.sql');
      expect(fs.existsSync(migrationPath)).toBe(true);

      const sql = fs.readFileSync(migrationPath, 'utf-8');

      // Check required enum types
      expect(sql).toContain('user_role');
      expect(sql).toContain('billing_period');
      expect(sql).toContain('sub_status');
      expect(sql).toContain('invoice_status');
      expect(sql).toContain('discount_type');
      expect(sql).toContain('payment_method');

      // Check key tables
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS users');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS customers');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS products');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS product_variants');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS taxes');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS plans');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS quotation_templates');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS subscriptions');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS subscription_lines');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS discounts');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS invoices');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS invoice_lines');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS payments');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS billing_runs');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_log');

      // Check key constraints and sequences
      expect(sql).toContain('subscription_number_seq');
      expect(sql).toContain('invoice_number_seq');
      expect(sql).toContain('uq_invoice_period UNIQUE (subscription_id, period_start, period_end)');
      expect(sql).toContain('block_audit_log_update_delete');
      expect(sql).toContain('protect_immutable_invoice_lines');
      expect(sql).toContain('protect_immutable_payments');
      expect(sql).toContain('mv_dashboard_summary');
      expect(sql).toContain('mv_monthly_revenue');
    });
  });
});
