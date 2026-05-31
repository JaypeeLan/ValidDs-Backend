/**
 * ValidDs Backend — Server Entry Point
 *
 * Startup sequence:
 *  1. Load and validate environment variables   (crashes fast if anything is missing)
 *  2. Initialise Sentry                         (must be before any other imports that throw)
 *  3. Connect MongoDB
 *  4. Connect Redis
 *  5. Create Express app
 *  6. Start HTTP server
 *  7. Register graceful shutdown handlers
 */

import path from 'path';
import dotenv from 'dotenv';

// Load from repo root (parent of `src/` or `dist/`) so it works even when cwd is wrong.
// `backend.env` is merged second so keys there fill gaps (common in monorepos / full-frontend tooling).
const envRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(envRoot, '.env') });
dotenv.config({ path: path.join(envRoot, 'backend.env') });

// Step 1: Validate env — crashes immediately if anything is wrong
import { env } from './config/env.validation';

// Step 2: Sentry — must be initialised before routes load
import { initialiseSentry } from './monitoring/sentry';
initialiseSentry();

import * as http from 'http';
import { createApp } from './app';
import { connectMongo, disconnectMongo } from './db/client';
import { getRedisClient, disconnectRedis } from './cache/redis.client';
import { logger } from './logger';
import { startJobs, stopJobs } from './jobs/index';
import { SocketService } from './config/socket';

const log = logger.child({ module: 'server' });

let server: http.Server;

async function start(): Promise<void> {
  const startTime = Date.now();
  log.info(`Starting ${env.APP_NAME}`, {
    env: env.NODE_ENV,
    version: process.env.npm_package_version ?? '1.0.0',
  });

  // Step 3: Initialise Express App earliest
  // This ensures we can start listening on the port ASAP to satisfy Render's health checks
  const app = await createApp();
  server = http.createServer(app);

  // Bind Socket.IO immediately to the underlying raw Node server
  SocketService.initialize(server);

  server.listen(env.PORT, () => {
    log.info(`HTTP server listening on port ${env.PORT}`, {
      apiBase: `/api/${env.API_VERSION}`,
      health: '/health',
      ready: '/ready',
      startupTimeMs: Date.now() - startTime,
    });
  });

  server.on('error', (err) => {
    log.fatal('HTTP server error', err);
    process.exit(1);
  });

  // Step 4: Database & Cache (Non-blocking for the HTTP port, but required for /ready)
  // We trigger these but don't strictly block the listen call
  try {
    await connectMongo();

    const redis = getRedisClient();
    await redis.ping();
    log.info('Redis ping OK');

    // Step 5: Background Jobs
    startJobs();
  } catch (err) {
    log.error('Post-startup initialization failed', err);
    // We don't exit here because the HTTP server is already running and might recover
    // or provide helpful error responses via health checks.
  }
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
      ]);
      stopJobs(),

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

/** ts-node-dev can throw EPIPE when the parent restarts mid hot-reload (harmless). */
function isBenignDevReloadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== 'EPIPE') return false;
  const stack = (err as Error).stack ?? '';
  return env.NODE_ENV === 'development' && stack.includes('ts-node-dev');
}

process.on('uncaughtException', (err) => {
  if (isBenignDevReloadError(err)) {
    log.debug('Ignored ts-node-dev reload IPC error (EPIPE)');
    return;
  }
  log.fatal('Uncaught exception', err);
  process.exit(1);
});

// Boot
start().catch((err) => {
  log.fatal('Failed to start server', err);
  process.exit(1);
});
