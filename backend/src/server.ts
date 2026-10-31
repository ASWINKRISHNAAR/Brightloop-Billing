import { createApp } from './app.js';
import { config } from './common/config.js';
import { logger } from './common/logger.js';
import { closePool } from './db/pool.js';

const app = createApp();

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(`Brightloop Billing API Server listening on http://${config.HOST}:${config.PORT}`);
  logger.info(`Health check: http://${config.HOST}:${config.PORT}/health`);
  logger.info(`SSE events: http://${config.HOST}:${config.PORT}/api/events`);
});

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  logger.info(`${signal} received. Initiating graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await closePool();
      logger.info('Database pool closed.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forceful shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
