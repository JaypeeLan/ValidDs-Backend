import express from 'express';
import * as http from 'http';
import { register } from './metrics';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'metrics-server' });

/**
 * Prometheus metrics server.
 *
 * Runs on a SEPARATE port (default: 9090) from the main API (default: 3000).
 * This is intentional — the /metrics endpoint should NEVER be exposed publicly.
 *
 * On Render free tier:
 *   - The main app runs on PORT (public)
 *   - The metrics server runs on METRICS_PORT (internal only — not exposed)
 *   - Configure your Prometheus scrape job to target the internal service URL
 *
 * The main Express app also has a GET /metrics route as a fallback,
 * protected by requireApiKey middleware.
 */

let metricsServer: http.Server | null = null;

export async function startMetricsServer(): Promise<void> {
  if (env.NODE_ENV === 'development') {
    return; // No metrics server in dev
  }

  if (!env.METRICS_ENABLED) return;

  const app = express();

  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.status(500).end(String(err));
    }
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  metricsServer = app.listen(env.METRICS_PORT, () => {
    log.info(`Metrics server listening on port ${env.METRICS_PORT}`);
  });
}

export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!metricsServer) return resolve();
    metricsServer.close(() => resolve());
  });
}
