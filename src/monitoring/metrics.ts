import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'metrics' });

/**
 * Prometheus metrics.
 *
 * Exposes a /metrics endpoint scraped by Prometheus (or Grafana Cloud free tier).
 * Default Node.js metrics (CPU, memory, event loop) are collected automatically.
 *
 * Custom metrics defined here:
 *   - ingestion_jobs_total         — ingestion job runs by source and status
 *   - ingestion_records_ingested   — number of records ingested per run
 *   - cache_hits_total / misses    — Redis cache efficiency
 *   - active_connections           — current MongoDB pool usage
 *
 * See docs/third-party/prometheus.md for scrape config and Grafana Cloud setup.
 */

export function initialiseMetrics(): void {
  if (env.NODE_ENV === 'development') {
    log.info('Prometheus metrics disabled in development mode');
    return;
  }

  if (!env.METRICS_ENABLED) {
    log.info('Metrics disabled via METRICS_ENABLED=false');
    return;
  }

  collectDefaultMetrics({ register });
  log.info('Prometheus metrics initialised');
}

// ── Ingestion metrics ───────────────────────────────────────────────────────

export const ingestionJobsTotal = new Counter({
  name: 'ingestion_jobs_total',
  help: 'Total number of ingestion job executions',
  labelNames: ['source', 'status'], // status: success | failure | fallback
});

export const ingestionRecordsIngested = new Counter({
  name: 'ingestion_records_ingested_total',
  help: 'Total number of records ingested',
  labelNames: ['source', 'entity'], // entity: product | video | trend
});

// ── Cache metrics ───────────────────────────────────────────────────────────

export const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Total Redis cache hits',
  labelNames: ['key_prefix'],
});

export const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Total Redis cache misses',
  labelNames: ['key_prefix'],
});

// ── System metrics ──────────────────────────────────────────────────────────

export const mongoConnectionsActive = new Gauge({
  name: 'mongo_connections_active',
  help: 'Active MongoDB connections in the pool',
});

export const dataFreshnessGauge = new Gauge({
  name: 'data_freshness_seconds',
  help: 'Seconds since last successful data ingestion per entity',
  labelNames: ['entity'],
});

// ── Registry export ─────────────────────────────────────────────────────────
export { register };
