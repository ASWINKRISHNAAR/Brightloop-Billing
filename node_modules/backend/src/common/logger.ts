import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : (process.env['LOG_LEVEL'] || 'info'),
  redact: {
    paths: [
      'password',
      'password_hash',
      'passwordHash',
      'token',
      'token_hash',
      'refreshToken',
      'authorization',
      'cookie',
      '*.password',
      '*.token'
    ],
    censor: '[REDACTED]'
  },
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: pino.stdTimeFunctions.isoTime
});
