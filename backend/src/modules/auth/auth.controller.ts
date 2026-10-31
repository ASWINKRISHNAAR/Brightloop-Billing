import type { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from './auth.schema.js';
import { config } from '../../common/config.js';
import { authRepository } from './auth.repository.js';
import { NotFoundError } from '../../common/errors.js';

const REFRESH_COOKIE_NAME = 'brightloop_refresh_token';

function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth'
  });
}

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = registerSchema.parse(req.body);
      const ip = req.ip || req.socket.remoteAddress;
      const result = await authService.registerCustomer(input, ip);

      setRefreshTokenCookie(res, result.tokens.refreshToken);

      res.status(201).json({
        data: {
          user: result.user,
          accessToken: result.tokens.accessToken,
          expiresInSeconds: result.tokens.expiresInSeconds
        },
        meta: {
          message: 'Registration successful'
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);
      const ip = req.ip || req.socket.remoteAddress;
      const result = await authService.login(input, ip);

      setRefreshTokenCookie(res, result.tokens.refreshToken);

      res.status(200).json({
        data: {
          user: result.user,
          accessToken: result.tokens.accessToken,
          expiresInSeconds: result.tokens.expiresInSeconds
        },
        meta: {
          message: 'Login successful'
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
      const tokens = await authService.refreshToken(rawToken);

      setRefreshTokenCookie(res, tokens.refreshToken);

      res.status(200).json({
        data: {
          accessToken: tokens.accessToken,
          expiresInSeconds: tokens.expiresInSeconds
        },
        meta: {
          message: 'Token refreshed'
        }
      });
    } catch (err) {
      clearRefreshTokenCookie(res);
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
      await authService.logout(rawToken, req.user?.userId);
      clearRefreshTokenCookie(res);

      res.status(200).json({
        data: null,
        meta: {
          message: 'Logged out successfully'
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = forgotPasswordSchema.parse(req.body);
      const result = await authService.forgotPassword(input);

      res.status(200).json({
        data: null,
        meta: {
          message: result.message
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = resetPasswordSchema.parse(req.body);
      const result = await authService.resetPassword(input);

      res.status(200).json({
        data: null,
        meta: {
          message: result.message
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const user = await authRepository.findUserById(req.user.userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }

      let customer = null;
      if (user.role === 'customer') {
        customer = await authRepository.findCustomerByUserId(user.id);
      }

      res.status(200).json({
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: user.must_change_password,
          customer: customer ? {
            id: customer.id,
            company: customer.company,
            phone: customer.phone,
            addressLine1: customer.address_line1,
            city: customer.city,
            state: customer.state,
            country: customer.country
          } : null
        }
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
