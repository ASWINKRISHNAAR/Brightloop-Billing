import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { UnauthorizedError, ForbiddenError } from './errors.js';
import { TokenPayload } from '../modules/auth/auth.service.js';

// Extend Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authentication token missing or invalid');
  }

  const token = authHeader.substring(7).trim();
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as TokenPayload;
    req.user = decoded;
    next();
  } catch (_err) {
    throw new UnauthorizedError('Session expired or token invalid');
  }
}

export function requireRole(...allowedRoles: Array<'admin' | 'staff' | 'customer'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(`Forbidden: Requires one of [${allowedRoles.join(', ')}] role`);
    }

    next();
  };
}

export function enforceCustomerOwnership(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  if (req.user.role === 'customer') {
    if (!req.user.customerId) {
      throw new ForbiddenError('Customer account profile not linked');
    }

    // Check query or params if a customerId was provided that doesn't match
    const paramCustomerId = req.params['customerId'] || req.query['customerId'];
    if (paramCustomerId && paramCustomerId !== req.user.customerId) {
      throw new ForbiddenError('Access denied: You cannot access resources belonging to other customers');
    }
  }

  next();
}
