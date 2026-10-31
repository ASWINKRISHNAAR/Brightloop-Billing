import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../common/config.js';
import { withTransaction } from '../../db/pool.js';
import { authRepository, UserRow } from './auth.repository.js';
import {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  CreateStaffInput
} from './auth.schema.js';
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError
} from '../../common/errors.js';
import { sendEmail } from '../../common/email.js';

export interface TokenPayload {
  userId: string;
  email: string;
  role: 'admin' | 'staff' | 'customer';
  customerId?: string;
  mustChangePassword?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface AuthUserDTO {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff' | 'customer';
  customerId?: string;
  mustChangePassword: boolean;
}

export class AuthService {
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private generateTokens(payload: TokenPayload, familyId = uuidv4()): { tokens: AuthTokens; familyId: string; tokenHash: string; expiresAt: Date } {
    const accessToken = jwt.sign(payload, config.JWT_ACCESS_SECRET, {
      expiresIn: '15m'
    });

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    return {
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
        expiresInSeconds: 15 * 60
      },
      familyId,
      tokenHash,
      expiresAt
    };
  }

  async registerCustomer(input: RegisterInput, ipAddress?: string): Promise<{ user: AuthUserDTO; tokens: AuthTokens }> {
    const normalizedEmail = input.email.toLowerCase().trim();

    // Check duplicate email
    const existing = await authRepository.findUserByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError('A user with this email address already exists', {
        email: ['This email is already registered']
      });
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(input.password, saltRounds);

    return withTransaction(async (client) => {
      // Create user with customer role
      const user = await authRepository.createUser(
        {
          email: normalizedEmail,
          passwordHash,
          name: input.name,
          role: 'customer'
        },
        client
      );

      // Create customer record in the same transaction
      const customer = await authRepository.createCustomer(
        {
          userId: user.id,
          name: input.name,
          email: normalizedEmail,
          company: input.company,
          phone: input.phone
        },
        client
      );

      // Audit log
      await authRepository.writeAuditLog(
        {
          userId: user.id,
          action: 'user.registered',
          entity: 'users',
          entityId: user.id,
          afterState: { email: user.email, role: user.role, customerId: customer.id },
          ipAddress
        },
        client
      );

      const tokenPayload: TokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        customerId: customer.id
      };

      const { tokens, familyId, tokenHash, expiresAt } = this.generateTokens(tokenPayload);

      await authRepository.createRefreshToken(
        {
          userId: user.id,
          tokenHash,
          familyId,
          expiresAt
        },
        client
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          customerId: customer.id,
          mustChangePassword: user.must_change_password
        },
        tokens
      };
    });
  }

  async login(input: LoginInput, ipAddress?: string): Promise<{ user: AuthUserDTO; tokens: AuthTokens }> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const user = await authRepository.findUserByEmail(normalizedEmail);

    if (!user) {
      // Generic error prevents enumeration
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.is_active) {
      throw new ForbiddenError('Account is inactive. Please contact support.');
    }

    // Check account lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const waitMinutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / (60 * 1000));
      throw new ForbiddenError(`Account is temporarily locked due to consecutive failed attempts. Try again in ${waitMinutes} minutes.`);
    }

    // Constant-time password check
    const isMatch = await bcrypt.compare(input.password, user.password_hash);
    if (!isMatch) {
      const lockResult = await authRepository.incrementFailedLogin(
        user.id,
        config.LOCKOUT_DURATION_MINUTES,
        config.LOCKOUT_THRESHOLD
      );

      if (lockResult.locked) {
        throw new ForbiddenError(`Account is temporarily locked due to 5 consecutive failed attempts. Please try again after 15 minutes.`);
      }

      throw new UnauthorizedError('Invalid email or password');
    }

    // Reset failed logins & update last login
    await authRepository.updateLastLoginAndResetAttempts(user.id);

    // Look up customerId if customer role
    let customerId: string | undefined;
    if (user.role === 'customer') {
      const customer = await authRepository.findCustomerByUserId(user.id);
      customerId = customer?.id;
    }

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      customerId,
      mustChangePassword: user.must_change_password
    };

    const { tokens, familyId, tokenHash, expiresAt } = this.generateTokens(tokenPayload);

    await authRepository.createRefreshToken({
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt
    });

    await authRepository.writeAuditLog({
      userId: user.id,
      action: 'user.login',
      entity: 'users',
      entityId: user.id,
      ipAddress
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        customerId,
        mustChangePassword: user.must_change_password
      },
      tokens
    };
  }

  async refreshToken(rawRefreshToken: string): Promise<AuthTokens> {
    if (!rawRefreshToken) {
      throw new UnauthorizedError('Refresh token required');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const tokenRecord = await authRepository.findRefreshTokenByHash(tokenHash);

    if (!tokenRecord) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Reuse detection: if a revoked token is used, revoke the entire family!
    if (tokenRecord.is_revoked) {
      await authRepository.revokeRefreshTokenFamily(tokenRecord.family_id);
      throw new UnauthorizedError('Invalid refresh token. Session family revoked.');
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new UnauthorizedError('Refresh token has expired');
    }

    const user = await authRepository.findUserById(tokenRecord.user_id);
    if (!user || !user.is_active) {
      throw new UnauthorizedError('User account not found or inactive');
    }

    let customerId: string | undefined;
    if (user.role === 'customer') {
      const customer = await authRepository.findCustomerByUserId(user.id);
      customerId = customer?.id;
    }

    // Revoke old token & issue rotated token in the same family
    await authRepository.deleteRefreshTokenByHash(tokenHash);

    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      customerId,
      mustChangePassword: user.must_change_password
    };

    const { tokens, tokenHash: newHash, expiresAt } = this.generateTokens(tokenPayload, tokenRecord.family_id);

    await authRepository.createRefreshToken({
      userId: user.id,
      tokenHash: newHash,
      familyId: tokenRecord.family_id,
      expiresAt
    });

    return tokens;
  }

  async logout(rawRefreshToken?: string, userId?: string): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      const tokenRecord = await authRepository.findRefreshTokenByHash(tokenHash);
      if (tokenRecord) {
        await authRepository.revokeRefreshTokenFamily(tokenRecord.family_id);
      }
    }
    if (userId) {
      await authRepository.writeAuditLog({
        userId,
        action: 'user.logout',
        entity: 'users',
        entityId: userId
      });
    }
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<{ message: string }> {
    const user = await authRepository.findUserByEmail(input.email);

    // Always respond identically to avoid email enumeration
    const genericResponse = {
      message: 'If the email is registered in our system, a password reset link has been dispatched.'
    };

    if (!user || !user.is_active) {
      return genericResponse;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + config.RESET_TOKEN_EXPIRATION_MINUTES * 60 * 1000);

    await authRepository.createPasswordResetToken({
      userId: user.id,
      tokenHash,
      expiresAt
    });

    const resetLink = `http://localhost:5173/reset-password?token=${rawToken}`;
    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request - Brightloop Billing',
      text: `Hello ${user.name},\n\nYou requested to reset your password. Please click the link below to set a new password:\n\n${resetLink}\n\nThis link will expire in 30 minutes.\nIf you did not request this, please ignore this email.`
    });

    return genericResponse;
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const tokenHash = this.hashToken(input.token);
    const tokenRecord = await authRepository.findValidResetTokenByHash(tokenHash);

    if (!tokenRecord) {
      throw new ValidationError('Password reset link is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 12);

    await withTransaction(async (client) => {
      await authRepository.updatePassword(tokenRecord.user_id, passwordHash, true, client);
      await authRepository.markResetTokenUsed(tokenRecord.id, client);
      await authRepository.writeAuditLog(
        {
          userId: tokenRecord.user_id,
          action: 'user.password_reset',
          entity: 'users',
          entityId: tokenRecord.user_id
        },
        client
      );
    });

    return { message: 'Password has been successfully reset. You may now log in.' };
  }

  async createStaff(input: CreateStaffInput, adminUserId: string): Promise<UserRow> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const existing = await authRepository.findUserByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError('A user with this email address already exists', {
        email: ['This email is already registered']
      });
    }

    const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);

    const staffUser = await authRepository.createUser({
      email: normalizedEmail,
      passwordHash,
      name: input.name,
      role: 'staff',
      mustChangePassword: true
    });

    await authRepository.writeAuditLog({
      userId: adminUserId,
      action: 'staff.created',
      entity: 'users',
      entityId: staffUser.id,
      afterState: { email: staffUser.email, role: 'staff' }
    });

    return staffUser;
  }
}

export const authService = new AuthService();
