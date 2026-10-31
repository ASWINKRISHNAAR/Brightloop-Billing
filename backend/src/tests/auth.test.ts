import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { setupTestDatabase } from './testDb.js';
import { query } from '../db/pool.js';
import jwt from 'jsonwebtoken';
import { config } from '../common/config.js';

describe('Phase 2: Authentication, Authorization & Security Tests', () => {
  let app: any;

  beforeEach(async () => {
    setupTestDatabase();
    app = createApp();

    // Initialize required tables in test DB
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

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(id),
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        family_id VARCHAR(36) NOT NULL,
        is_revoked BOOLEAN NOT NULL DEFAULT false,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(id),
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
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
  });

  describe('1. Customer Registration', () => {
    it('successfully registers customer with strong password and creates customer record', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'Customer.One@Brightloop.IO',
          password: 'Password123!',
          name: 'Customer One',
          company: 'Acme Corp'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe('customer.one@brightloop.io'); // normalized
      expect(res.body.data.user.role).toBe('customer');
      expect(res.body.data.user.customerId).toBeDefined();
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.headers['set-cookie']).toBeDefined();

      // Check DB customer record was created
      const custCheck = await query('SELECT * FROM customers WHERE email = $1', ['customer.one@brightloop.io']);
      expect(custCheck.rows.length).toBe(1);
      expect(custCheck.rows[0].name).toBe('Customer One');
    });

    it('rejects duplicate email with 409 Conflict and field error', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'dup@brightloop.io',
          password: 'Password123!',
          name: 'First Register'
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'DUP@brightloop.io',
          password: 'Password123!',
          name: 'Second Register'
        });

      expect(res.status).toBe(409);
      expect(res.body.title).toBe('ConflictError');
      expect(res.body.errors).toHaveProperty('email');
    });

    it('validates password complexity (length, uppercase, lowercase, special char)', async () => {
      // Too short
      const short = await request(app).post('/api/auth/register').send({
        email: 'test1@brightloop.io',
        password: 'Pass1!',
        name: 'Test'
      });
      expect(short.status).toBe(400);

      // No uppercase
      const noUpper = await request(app).post('/api/auth/register').send({
        email: 'test2@brightloop.io',
        password: 'password123!',
        name: 'Test'
      });
      expect(noUpper.status).toBe(400);

      // No special character
      const noSpecial = await request(app).post('/api/auth/register').send({
        email: 'test3@brightloop.io',
        password: 'Password123',
        name: 'Test'
      });
      expect(noSpecial.status).toBe(400);
    });
  });

  describe('2. Login and Lockout', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send({
        email: 'alice@brightloop.io',
        password: 'Password123!',
        name: 'Alice'
      });
    });

    it('logs in successfully with correct credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'Alice@brightloop.io',
        password: 'Password123!'
      });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('alice@brightloop.io');
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('returns generic 401 on incorrect password without leaking existence', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'alice@brightloop.io',
        password: 'WrongPassword123!'
      });

      expect(res.status).toBe(401);
      expect(res.body.detail).toBe('Invalid email or password');
    });

    it('locks account after 5 consecutive failed login attempts', async () => {
      await request(app).post('/api/auth/register').send({
        email: 'lockout_target@brightloop.io',
        password: 'Password123!',
        name: 'Lockout Target'
      });

      for (let i = 0; i < 4; i++) {
        const fail = await request(app).post('/api/auth/login').send({
          email: 'lockout_target@brightloop.io',
          password: 'WrongPassword!'
        });
        expect(fail.status).toBe(401);
      }

      // 5th attempt locks account
      const fifth = await request(app).post('/api/auth/login').send({
        email: 'lockout_target@brightloop.io',
        password: 'WrongPassword!'
      });
      expect(fifth.status).toBe(403);
      expect(fifth.body.detail).toContain('temporarily locked');

      // Subsequent attempt even with correct password is locked
      const blocked = await request(app).post('/api/auth/login').send({
        email: 'lockout_target@brightloop.io',
        password: 'Password123!'
      });
      expect(blocked.status).toBe(403);
    });
  });

  describe('3. Token Refresh and Reuse Detection', () => {
    it('rotates refresh token on /api/auth/refresh', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        email: 'bob@brightloop.io',
        password: 'Password123!',
        name: 'Bob'
      });

      const cookies = (reg.headers['set-cookie'] as string[] | undefined) || [];
      const rawCookie = cookies.find((c: string) => c.startsWith('brightloop_refresh_token='));
      expect(rawCookie).toBeDefined();
      const tokenVal = rawCookie!.split(';')[0]!.split('=')[1]!;

      const ref = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`brightloop_refresh_token=${tokenVal}`]);

      expect(ref.status).toBe(200);
      expect(ref.body.data.accessToken).toBeDefined();

      const newCookies = (ref.headers['set-cookie'] as string[] | undefined) || [];
      const newCookie = newCookies.find((c: string) => c.startsWith('brightloop_refresh_token='));
      expect(newCookie).toBeDefined();
      const newTokenVal = newCookie!.split(';')[0]!.split('=')[1]!;
      expect(newTokenVal).not.toBe(tokenVal); // rotated
    });

    it('detects reuse of old refresh token and revokes entire family', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        email: 'carol@brightloop.io',
        password: 'Password123!',
        name: 'Carol'
      });

      const cookies = (reg.headers['set-cookie'] as string[] | undefined) || [];
      const rawCookie = cookies.find((c: string) => c.startsWith('brightloop_refresh_token='));
      expect(rawCookie).toBeDefined();
      const tokenVal = rawCookie!.split(';')[0]!.split('=')[1]!;

      // Refresh once
      const ref1 = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`brightloop_refresh_token=${tokenVal}`]);
      expect(ref1.status).toBe(200);

      // Try to reuse the first token again
      const reuseAttempt = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`brightloop_refresh_token=${tokenVal}`]);
      expect(reuseAttempt.status).toBe(401);
    });
  });

  describe('4. Forgot and Reset Password Flow', () => {
    it('always responds identically on forgot-password', async () => {
      const nonExistent = await request(app).post('/api/auth/forgot-password').send({
        email: 'unknown@brightloop.io'
      });
      expect(nonExistent.status).toBe(200);
      expect(nonExistent.body.meta.message).toContain('If the email is registered');

      await request(app).post('/api/auth/register').send({
        email: 'existing@brightloop.io',
        password: 'Password123!',
        name: 'Existing'
      });

      const existing = await request(app).post('/api/auth/forgot-password').send({
        email: 'existing@brightloop.io'
      });
      expect(existing.status).toBe(200);
      expect(existing.body.meta.message).toBe(nonExistent.body.meta.message);
    });
  });

  describe('5. Staff Management & RBAC IDOR Protection', () => {
    let adminToken: string;
    let staffToken: string;
    let customerToken: string;

    beforeEach(async () => {
      // 1. Create Admin
      await query(
        `INSERT INTO users (id, email, password_hash, name, role) 
         VALUES ('admin-1', 'admin@brightloop.io', 'hash', 'Super Admin', 'admin')`
      );
      adminToken = jwt.sign(
        { userId: 'admin-1', email: 'admin@brightloop.io', role: 'admin' },
        config.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
      );

      // 2. Create Staff
      await query(
        `INSERT INTO users (id, email, password_hash, name, role) 
         VALUES ('staff-1', 'staff@brightloop.io', 'hash', 'Staff Member', 'staff')`
      );
      staffToken = jwt.sign(
        { userId: 'staff-1', email: 'staff@brightloop.io', role: 'staff' },
        config.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
      );

      // 3. Create Customer A
      await query(
        `INSERT INTO users (id, email, password_hash, name, role) 
         VALUES ('cust-a-id', 'custA@brightloop.io', 'hash', 'Customer A', 'customer')`
      );
      await query(
        `INSERT INTO customers (id, user_id, name, email) 
         VALUES ('cust-a-uuid', 'cust-a-id', 'Customer A', 'custA@brightloop.io')`
      );
      customerToken = jwt.sign(
        { userId: 'cust-a-id', email: 'custA@brightloop.io', role: 'customer', customerId: 'cust-a-uuid' },
        config.JWT_ACCESS_SECRET,
        { expiresIn: '1h' }
      );
    });

    it('allows Admin to create staff with temporary password and must_change_password=true', async () => {
      const res = await request(app)
        .post('/api/staff')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'newstaff@brightloop.io',
          name: 'New Staff',
          temporaryPassword: 'TempPassword123!'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe('staff');
      expect(res.body.data.mustChangePassword).toBe(true);
    });

    it('blocks Staff and Customers from creating staff (403 Forbidden)', async () => {
      // Staff cannot create staff
      const staffAttempt = await request(app)
        .post('/api/staff')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          email: 'hacked@brightloop.io',
          name: 'Hacked',
          temporaryPassword: 'TempPassword123!'
        });
      expect(staffAttempt.status).toBe(403);

      // Customer cannot create staff
      const custAttempt = await request(app)
        .post('/api/staff')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          email: 'hacked@brightloop.io',
          name: 'Hacked',
          temporaryPassword: 'TempPassword123!'
        });
      expect(custAttempt.status).toBe(403);
    });
  });
});
