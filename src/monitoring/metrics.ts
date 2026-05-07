import { logger } from '../logger';

const log = logger.child({ module: 'metrics' });

/**
 * Prometheus metrics.
 *
 * Exposes a /metrics endpoint scraped by Prometheus (or Grafana Cloud free tier).
 * Default Node.js metrics (CPU, memory, event loop) are collected automatically.
 *
 * Custom metrics defined here:
 *   - http_requests_total          — request count by method, route, status
 *   - http_request_duration_ms     — response time histogram
 *   - ingestion_jobs_total         — ingestion job runs by source and status
 *   - ingestion_records_ingested   — number of records ingested per run
 *   - cache_hits_total / misses    — Redis cache efficiency
 *   - active_connections           — current MongoDB pool usage
 *
 * See docs/third-party/prometheus.md for scrape config and Grafana Cloud setup.
 */

/**
 * Dependency-free metrics stubs.
 *
 * Prometheus libs were removed from this project; keep the same API surface so
 * instrumentation calls remain valid without pulling extra dependencies.
 */
type LabelValues = Record<string, string | number>;

class NoopCounter {
  inc(_labels?: LabelValues, _value?: number): void {}
}

class NoopHistogram {
  observe(_labels?: LabelValues, _value?: number): void {}
}

class NoopGauge {
  set(_labels: LabelValues, _value?: number): void {}
}

export const register = {
  contentType: 'text/plain; charset=utf-8',
  async metrics(): Promise<string> {
    return '# Metrics are disabled in this build.\n';
  },
};

export function initialiseMetrics(): void {
  log.info('Metrics initialised in no-op mode');
}

// ── HTTP metrics ────────────────────────────────────────────────────────────

export const httpRequestsTotal = new NoopCounter();

export const httpRequestDurationMs = new NoopHistogram();

// ── Ingestion metrics ───────────────────────────────────────────────────────

export const ingestionJobsTotal = new NoopCounter();

export const ingestionRecordsIngested = new NoopCounter();

// ── Cache metrics ───────────────────────────────────────────────────────────

export const cacheHitsTotal = new NoopCounter();

export const cacheMissesTotal = new NoopCounter();

// ── System metrics ──────────────────────────────────────────────────────────

export const mongoConnectionsActive = new NoopGauge();

export const dataFreshnessGauge = new NoopGauge();

// register is exported above.
