/**
 * ValidDs Backend — Server Entry Point
 *
 * Startup sequence:
 *  1. Load and validate environment variables   (crashes fast if anything is missing)
 *  2. Initialise Sentry                         (must be before any other imports that throw)
 *  3. Connect MongoDB
 *  4. Connect Redis
 *  5. Initialise Prometheus metrics
 *  6. Start metrics server (separate port)
 *  7. Create Express app
 *  8. Start HTTP server
 *  9. Register graceful shutdown handlers
 */

import 'dotenv/config';

// Step 1: Validate env — crashes immediately if anything is wrong
import { env } from './config/env.validation';

// Step 2: Sentry — must be initialised before routes load
import { initialiseSentry } from './monitoring/sentry';
initialiseSentry();

import * as http from 'http';
import { createApp } from './app';
import { connectMongo, disconnectMongo } from './db/client';
import { getRedisClient, disconnectRedis } from './cache/redis.client';
import { startMetricsServer, stopMetricsServer } from './monitoring/metrics.routes';
import { initialiseMetrics } from './monitoring/metrics';
import { logger } from './logger';

const log = logger.child({ module: 'server' });

let server: http.Server;

async function start(): Promise<void> {
  log.info(`Starting ${env.APP_NAME}`, {
    env: env.NODE_ENV,
    version: process.env.npm_package_version ?? '1.0.0',
  });

  // Step 3: MongoDB
  await connectMongo();

  // Step 4: Redis (eager connect to catch config issues at startup)
  const redis = getRedisClient();
  await redis.ping();
  log.info('Redis ping OK');

  // Step 5 & 6: Metrics
  initialiseMetrics();
  await startMetricsServer();

  // Step 7 & 8: Express
  const app = createApp();
  server = http.createServer(app);

  server.listen(env.PORT, () => {
    log.info(`HTTP server listening on port ${env.PORT}`, {
      apiBase: `/api/${env.API_VERSION}`,
      health: '/health',
      ready: '/ready',
    });
  });

  server.on('error', (err) => {
    log.fatal('HTTP server error', err);
    process.exit(1);
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  log.info(`${signal} received — shutting down gracefully`);

  // Stop accepting new connections
  server?.close(async () => {
    log.info('HTTP server closed');

    try {
      await Promise.all([
        disconnectMongo(),
        disconnectRedis(),
        stopMetricsServer(),
      ]);
      log.info('All connections closed. Goodbye.');
      process.exit(0);
    } catch (err) {
      log.error('Error during shutdown', err);
      process.exit(1);
    }
  });

  // Force kill after 10s if graceful shutdown stalls
  setTimeout(() => {
    log.error('Graceful shutdown timed out — force exiting');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled rejections — log and exit so the process manager restarts cleanly
process.on('unhandledRejection', (reason) => {
  log.fatal('Unhandled promise rejection', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  log.fatal('Uncaught exception', err);
  process.exit(1);
});

// Boot
start().catch((err) => {
  log.fatal('Failed to start server', err);
  process.exit(1);
});
