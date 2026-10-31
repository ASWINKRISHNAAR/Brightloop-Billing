import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './common/config.js';
import { errorMiddleware } from './common/errorMiddleware.js';
import { eventBus } from './common/events.js';
import { NotFoundError } from './common/errors.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { staffRouter } from './modules/staff/staff.routes.js';
import { taxesRouter } from './modules/taxes/taxes.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { plansRouter } from './modules/plans/plans.routes.js';
import { templatesRouter } from './modules/templates/templates.routes.js';

export function createApp(): express.Application {
  const app = express();

  // 1. Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false // Allows Swagger UI and local development
    })
  );

  // 2. CORS configuration
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key']
    })
  );

  // 3. Body Parsing & Cookies
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // 4. Global Request-ID & Correlation
  app.use((req, res, next) => {
    const reqId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    res.setHeader('X-Request-ID', reqId);
    next();
  });

  // 5. Rate Limiting
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      type: 'https://brightloop.io/errors/too-many-requests',
      title: 'TooManyRequests',
      status: 429,
      detail: 'Too many requests, please try again later.'
    }
  });
  app.use(globalLimiter);

  // 6. Health & Readiness Probe
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // 7. Real-Time Server-Sent Events (SSE) Endpoint
  app.get('/api/events', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Send initial handshake
    res.write(`event: connected\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);

    eventBus.registerClient(res);
  });

  // Mount Feature Modules
  app.use('/api/auth', authRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/taxes', taxesRouter);
  app.use('/api', catalogRouter);
  app.use('/api/plans', plansRouter);
  app.use('/api/quotation-templates', templatesRouter);

  // 8. 404 handler for undefined routes
  app.use((req, _res, next) => {
    next(new NotFoundError(`Endpoint ${req.method} ${req.originalUrl} not found`));
  });

  // 9. Central Error Middleware (RFC 9457)
  app.use(errorMiddleware);

  return app;
}
