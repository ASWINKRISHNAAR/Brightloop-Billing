import crypto from 'crypto';
import { query, DbClient } from '../../db/pool.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: 'admin' | 'staff' | 'customer';
  is_active: boolean;
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  is_revoked: boolean;
  expires_at: Date;
  created_at: Date;
}

export interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export class AuthRepository {
  async findUserByEmail(email: string, client?: DbClient): Promise<UserRow | null> {
    const res = await query<UserRow>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()],
      client
    );
    return res.rows[0] || null;
  }

  async findUserById(id: string, client?: DbClient): Promise<UserRow | null> {
    const res = await query<UserRow>(
      'SELECT * FROM users WHERE id = $1',
      [id],
      client
    );
    return res.rows[0] || null;
  }

  async createUser(
    userData: {
      email: string;
      passwordHash: string;
      name: string;
      role: 'admin' | 'staff' | 'customer';
      mustChangePassword?: boolean;
    },
    client?: DbClient
  ): Promise<UserRow> {
    const id = crypto.randomUUID();
    const res = await query<UserRow>(
      `INSERT INTO users (id, email, password_hash, name, role, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        userData.email.toLowerCase().trim(),
        userData.passwordHash,
        userData.name,
        userData.role,
        userData.mustChangePassword ?? false
      ],
      client
    );
    return res.rows[0]!;
  }

  async createCustomer(
    customerData: {
      userId: string;
      name: string;
      email: string;
      company?: string;
      phone?: string;
    },
    client?: DbClient
  ): Promise<CustomerRow> {
    const id = crypto.randomUUID();
    const res = await query<CustomerRow>(
      `INSERT INTO customers (id, user_id, name, email, company, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        customerData.userId,
        customerData.name,
        customerData.email.toLowerCase().trim(),
        customerData.company ?? null,
        customerData.phone ?? null
      ],
      client
    );
    return res.rows[0]!;
  }

  async findCustomerByUserId(userId: string, client?: DbClient): Promise<CustomerRow | null> {
    const res = await query<CustomerRow>(
      'SELECT * FROM customers WHERE user_id = $1',
      [userId],
      client
    );
    return res.rows[0] || null;
  }

  async updateLastLoginAndResetAttempts(userId: string, client?: DbClient): Promise<void> {
    await query(
      `UPDATE users 
       SET failed_login_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [userId],
      client
    );
  }

  async incrementFailedLogin(userId: string, lockoutMinutes: number, lockoutThreshold: number, client?: DbClient): Promise<{ locked: boolean; attempts: number }> {
    const res = await query<UserRow>(
      `UPDATE users 
       SET failed_login_attempts = failed_login_attempts + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING failed_login_attempts`,
      [userId],
      client
    );

    const attempts = res.rows[0]?.failed_login_attempts ?? 0;
    if (attempts >= lockoutThreshold) {
      const lockedUntilDate = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      await query(
        'UPDATE users SET locked_until = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [lockedUntilDate, userId],
        client
      );
      return { locked: true, attempts };
    }

    return { locked: false, attempts };
  }

  async updatePassword(userId: string, passwordHash: string, clearMustChange = true, client?: DbClient): Promise<void> {
    await query(
      `UPDATE users 
       SET password_hash = $1, 
           must_change_password = CASE WHEN $2 THEN false ELSE must_change_password END,
           failed_login_attempts = 0,
           locked_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [passwordHash, clearMustChange, userId],
      client
    );
  }

  async createRefreshToken(
    tokenData: {
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
    },
    client?: DbClient
  ): Promise<RefreshTokenRow> {
    const id = crypto.randomUUID();
    const res = await query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, tokenData.userId, tokenData.tokenHash, tokenData.familyId, tokenData.expiresAt],
      client
    );
    return res.rows[0]!;
  }

  async findRefreshTokenByHash(tokenHash: string, client?: DbClient): Promise<RefreshTokenRow | null> {
    const res = await query<RefreshTokenRow>(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
      client
    );
    return res.rows[0] || null;
  }

  async revokeRefreshTokenFamily(familyId: string, client?: DbClient): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET is_revoked = true WHERE family_id = $1',
      [familyId],
      client
    );
  }

  async deleteRefreshTokenByHash(tokenHash: string, client?: DbClient): Promise<void> {
    await query(
      'DELETE FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
      client
    );
  }

  async createPasswordResetToken(
    tokenData: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
    },
    client?: DbClient
  ): Promise<PasswordResetTokenRow> {
    // Invalidate existing unused tokens for user
    await query(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
      [tokenData.userId],
      client
    );

    const id = crypto.randomUUID();
    const res = await query<PasswordResetTokenRow>(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, tokenData.userId, tokenData.tokenHash, tokenData.expiresAt],
      client
    );
    return res.rows[0]!;
  }

  async findValidResetTokenByHash(tokenHash: string, client?: DbClient): Promise<PasswordResetTokenRow | null> {
    const res = await query<PasswordResetTokenRow>(
      `SELECT * FROM password_reset_tokens 
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [tokenHash],
      client
    );
    return res.rows[0] || null;
  }

  async markResetTokenUsed(tokenId: string, client?: DbClient): Promise<void> {
    await query(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [tokenId],
      client
    );
  }

  async writeAuditLog(
    entry: {
      userId?: string | null;
      action: string;
      entity: string;
      entityId: string;
      beforeState?: Record<string, any> | null;
      afterState?: Record<string, any> | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
    client?: DbClient
  ): Promise<void> {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO audit_log (id, user_id, action, entity, entity_id, before_state, after_state, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        entry.userId ?? null,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.beforeState ? JSON.stringify(entry.beforeState) : null,
        entry.afterState ? JSON.stringify(entry.afterState) : null,
        entry.ipAddress ?? null,
        entry.userAgent ?? null
      ],
      client
    );
  }

  async listStaff(client?: DbClient): Promise<UserRow[]> {
    const res = await query<UserRow>(
      "SELECT * FROM users WHERE role = 'staff' ORDER BY created_at DESC",
      [],
      client
    );
    return res.rows;
  }

  async updateUserActiveStatus(id: string, isActive: boolean, client?: DbClient): Promise<UserRow | null> {
    const res = await query<UserRow>(
      'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [isActive, id],
      client
    );
    return res.rows[0] || null;
  }
}

export const authRepository = new AuthRepository();
