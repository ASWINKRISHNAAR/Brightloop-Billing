import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Database
  DATABASE_URL: z.string().default('postgresql://brightloop:brightloop_pass@localhost:5432/brightloop_db'),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(20),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_EXPIRATION: z.string().default('7d'),

  // SMTP MailHog
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().default('"Brightloop Billing" <billing@brightloop.local>'),

  // App Rules
  LOCKOUT_THRESHOLD: z.coerce.number().default(5),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().default(15),
  RESET_TOKEN_EXPIRATION_MINUTES: z.coerce.number().default(30),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('CRITICAL: Configuration validation failed:', parsed.error.format());
  throw new Error('Environment configuration validation failure. Check environment variables.');
}

export const config = parsed.data;
export type Config = z.infer<typeof configSchema>;
