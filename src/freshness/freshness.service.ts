import { logger } from '../logger';
import { dataFreshnessGauge } from '../monitoring/metrics';
import { Alerts } from '../monitoring/alerts';
import { CacheService } from '../cache/cache.service';
import { CacheKeys, CACHE_TTL } from '../cache/cache.keys';

const log = logger.child({ module: 'freshness' });

/**
 * Data freshness thresholds in milliseconds.
 *
 * If an entity's data exceeds its threshold without a fresh update,
 * the freshness service marks it as stale and triggers a fallback
 * behavior (serve stale with warning, or block depending on entity).
 */
export const FRESHNESS_THRESHOLDS_MS = {
  product: 2 * 60 * 60 * 1000,    // 2 hours — core product data
  video: 1 * 60 * 60 * 1000,      // 1 hour — video signals refresh fast
  trend: 30 * 60 * 1000,           // 30 minutes — trend data is time-sensitive
  store: 6 * 60 * 60 * 1000,      // 6 hours — store data is stable
  supplier: 24 * 60 * 60 * 1000,  // 24 hours — supplier data rarely changes
} as const;

export type EntityType = keyof typeof FRESHNESS_THRESHOLDS_MS;

export interface FreshnessStatus {
  entity: EntityType;
  lastUpdatedAt: Date | null;
  ageMs: number | null;
  isStale: boolean;
  thresholdMs: number;
}

export const FreshnessService = {

  /**
   * Record a successful data update for an entity type.
   * Call this at the end of every successful ingestion job.
   */
  async markUpdated(entity: EntityType): Promise<void> {
    const now = new Date();
    const key = CacheKeys.ingestionLastRun(entity);
    await CacheService.set(key, now.toISOString(), CACHE_TTL.INGESTION_STATE);

    // Update Prometheus gauge (seconds since last update = 0 right now)
    dataFreshnessGauge.set({ entity }, 0);
    log.debug(`Freshness updated for ${entity}`);
  },

  /**
   * Get the freshness status for an entity type.
   */
  async getStatus(entity: EntityType): Promise<FreshnessStatus> {
    const key = CacheKeys.ingestionLastRun(entity);
    const stored = await CacheService.get<string>(key);
    const thresholdMs = FRESHNESS_THRESHOLDS_MS[entity];

    if (!stored) {
      return {
        entity,
        lastUpdatedAt: null,
        ageMs: null,
        isStale: true,
        thresholdMs,
      };
    }

    const lastUpdatedAt = new Date(stored);
    const ageMs = Date.now() - lastUpdatedAt.getTime();
    const isStale = ageMs > thresholdMs;

    // Update Prometheus gauge
    dataFreshnessGauge.set({ entity }, Math.floor(ageMs / 1000));

    return { entity, lastUpdatedAt, ageMs, isStale, thresholdMs };
  },

  /**
   * Check all entities and send alerts for any that are stale.
   * Run this periodically (e.g. every 10 minutes via a cron job).
   */
  async checkAll(): Promise<void> {
    const entities = Object.keys(FRESHNESS_THRESHOLDS_MS) as EntityType[];

    for (const entity of entities) {
      const status = await FreshnessService.getStatus(entity);

      if (status.isStale) {
        const ageMinutes = status.ageMs ? Math.round(status.ageMs / 60000) : null;
        log.warn(`Stale data detected`, { entity, ageMinutes });

        await Alerts.staleDataDetected(entity, ageMinutes ?? -1);
      }
    }
  },

  /**
   * Returns a freshness metadata object suitable for including in API responses.
   * Clients can use this to show "last updated X minutes ago" in the UI.
   */
  async getResponseMetadata(entity: EntityType): Promise<{
    lastUpdatedAt: string | null;
    isStale: boolean;
    freshnessLabel: string;
  }> {
    const status = await FreshnessService.getStatus(entity);

    let freshnessLabel = 'unknown';
    if (status.lastUpdatedAt && status.ageMs !== null) {
      const minutes = Math.floor(status.ageMs / 60000);
      if (minutes < 1) freshnessLabel = 'just now';
      else if (minutes < 60) freshnessLabel = `${minutes}m ago`;
      else freshnessLabel = `${Math.floor(minutes / 60)}h ago`;
    }

    return {
      lastUpdatedAt: status.lastUpdatedAt?.toISOString() ?? null,
      isStale: status.isStale,
      freshnessLabel,
    };
  },
};
