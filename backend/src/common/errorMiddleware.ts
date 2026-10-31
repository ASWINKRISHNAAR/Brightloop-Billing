import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import { logger } from './logger.js';

export const errorMiddleware: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const requestId = (req.headers['x-request-id'] as string) || 'req-' + Date.now();

  // 1. AppError subclasses
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      type: err.type,
      title: err.name,
      status: err.statusCode,
      detail: err.message,
      ...(err.fieldErrors ? { errors: err.fieldErrors } : {}),
      requestId
    });
    return;
  }

  // 2. Zod Validation Errors
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || 'root';
      if (!fieldErrors[path]) {
        fieldErrors[path] = [];
      }
      fieldErrors[path].push(issue.message);
    }

    const messages = err.issues.map((i) => i.message).filter(Boolean);
    const detailMsg = messages.length > 0 ? messages.join('. ') : 'Request validation failed';

    res.status(400).json({
      type: 'https://brightloop.io/errors/validation-error',
      title: 'ValidationError',
      status: 400,
      detail: detailMsg,
      errors: fieldErrors,
      requestId
    });
    return;
  }

  // 3. PostgreSQL unique constraint violation (code 23505)
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505') {
    const pgErr = err as { detail?: string };
    res.status(409).json({
      type: 'https://brightloop.io/errors/conflict',
      title: 'ConflictError',
      status: 409,
      detail: pgErr.detail || 'Unique constraint violation occurred',
      requestId
    });
    return;
  }

  // 4. Unexpected server error
  logger.error({ err, requestId, url: req.originalUrl, method: req.method }, 'Unhandled Exception');

  res.status(500).json({
    type: 'https://brightloop.io/errors/internal-server-error',
    title: 'InternalServerError',
    status: 500,
    detail: 'An unexpected internal error occurred. Please contact support.',
    requestId
  });
};
