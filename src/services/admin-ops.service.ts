import mongoose from 'mongoose';
import { getJobsStatus } from '../jobs/index';
import { getMarketModels } from '../models/market-models.factory';
import { MARKET_CODES, type MarketCode } from '../utils/markets';
import {
  adminCreativeAdTypeMatch,
  CREATIVE_META_ADS_MATCH,
  CREATIVE_TOP_ADS_MATCH,
  CREATIVE_TRENDING_MATCH,
} from '../utils/creative-response.util';
import {
  providerSummary,
  runProviderHealthChecks,
  type ProviderHealthCheck,
} from './provider-health.service';

export interface MaintenanceRunRow {
  id: string;
  runType: string;
  trigger: string;
  status: string;
  ok: boolean | null;
  startedAt: string;
  finishedAt: string | null;
  durationSec: number | null;
  summary: Record<string, unknown>;
  error: string | null;
  host: string;
  markets: string[];
}

export interface JobHeartbeatRow {
  job: string;
  market: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastOk: boolean | null;
  lastSummary: Record<string, unknown>;
  lastError: string | null;
  runs: number;
  okRuns: number;
  failRuns: number;
  stale: boolean;
  staleReason: string | null;
  history: Array<{
    ok: boolean;
    at: string;
    durationSec?: number;
    summary: Record<string, unknown>;
    error?: string | null;
  }>;
}

const MAINTENANCE_SCHEDULE = '09:00 WAT (Africa/Lagos) daily';

/** Jobs we still schedule / care about on the Operations surface. */
export const OPS_TRACKED_HEARTBEAT_JOBS = [
  'product_metrics_refresh',
  'product_prices_refresh',
  'meta_ads_refresh',
  'product_promo_videos_refresh',
  'discovery_sections_refresh',
] as const;

/** Product-maintenance owned run types (meta/promo moved to scraper). */
const MAINTENANCE_RUN_TYPES = [
  'full_maintenance',
  'product_metrics_refresh',
  'product_prices_refresh',
  'discovery_sections_refresh',
] as const;

/** Legacy cycle names that used to abort full_maintenance — ignore in issue lists. */
const LEGACY_FULL_MAINTENANCE_CYCLES = new Set([
  'meta_ads_refresh',
  'product_promo_videos_refresh',
]);

const STALE_HOURS_BY_JOB: Record<string, number> = {
  product_metrics_refresh: 30,
  product_prices_refresh: 30,
  meta_ads_refresh: 30,
  product_promo_videos_refresh: 30,
  discovery_sections_refresh: 48,
  full_maintenance: 30,
};

function maintenanceCollection() {
  return mongoose.connection.db?.collection('maintenance_runs') ?? null;
}

function jobRunsCollection() {
  return mongoose.connection.db?.collection('job_runs') ?? null;
}

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function serializeRun(doc: Record<string, unknown>): MaintenanceRunRow {
  return {
    id: String(doc._id),
    runType: String(doc.runType ?? ''),
    trigger: String(doc.trigger ?? ''),
    status: String(doc.status ?? ''),
    ok: doc.ok === null || doc.ok === undefined ? null : Boolean(doc.ok),
    startedAt: toIso(doc.startedAt) ?? new Date(0).toISOString(),
    finishedAt: toIso(doc.finishedAt),
    durationSec: typeof doc.durationSec === 'number' ? doc.durationSec : null,
    summary: (doc.summary as Record<string, unknown>) ?? {},
    error: doc.error ? String(doc.error) : null,
    host: String(doc.host ?? ''),
    markets: Array.isArray(doc.markets) ? doc.markets.map(String) : [],
  };
}

function computeStale(
  job: string,
  lastSuccessAt: string | null,
  lastRunAt: string | null,
): {
  stale: boolean;
  staleReason: string | null;
} {
  const maxHours = STALE_HOURS_BY_JOB[job] ?? 36;
  const ref = lastSuccessAt ?? lastRunAt;
  if (!ref) {
    return { stale: true, staleReason: 'Never recorded' };
  }
  const ageHours = (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60);
  if (ageHours > maxHours) {
    return {
      stale: true,
      staleReason: `Last success ${Math.round(ageHours)}h ago (threshold ${maxHours}h)`,
    };
  }
  return { stale: false, staleReason: null };
}

function serializeJob(doc: Record<string, unknown>): JobHeartbeatRow {
  const job = String(doc.job ?? '');
  const lastSuccessAt = toIso(doc.lastSuccessAt);
  const lastRunAt = toIso(doc.lastRunAt);
  const { stale, staleReason } = computeStale(job, lastSuccessAt, lastRunAt);
  const history = Array.isArray(doc.history)
    ? doc.history.map((h: Record<string, unknown>) => ({
        ok: Boolean(h.ok),
        at: toIso(h.at) ?? '',
        durationSec: typeof h.durationSec === 'number' ? h.durationSec : undefined,
        summary: (h.summary as Record<string, unknown>) ?? {},
        error: h.error ? String(h.error) : null,
      }))
    : [];

  return {
    job,
    market: String(doc.market ?? ''),
    lastRunAt,
    lastSuccessAt,
    lastOk: doc.lastOk === undefined ? null : Boolean(doc.lastOk),
    lastSummary: (doc.lastSummary as Record<string, unknown>) ?? {},
    lastError: doc.lastError ? String(doc.lastError) : null,
    runs: Number(doc.runs ?? 0),
    okRuns: Number(doc.okRuns ?? 0),
    failRuns: Number(doc.failRuns ?? 0),
    stale,
    staleReason,
    history: history.reverse(),
  };
}

export async function listMaintenanceRuns(opts: {
  page?: number;
  limit?: number;
  runType?: string;
  status?: string;
}): Promise<{
  runs: MaintenanceRunRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 20, 100);
  const skip = (page - 1) * limit;
  const col = maintenanceCollection();
  if (!col) {
    return { runs: [], pagination: { page, limit, total: 0, totalPages: 1 } };
  }

  const filter: Record<string, unknown> = {};
  if (opts.runType) {
    filter.runType = opts.runType;
  } else {
    filter.runType = { $in: [...MAINTENANCE_RUN_TYPES] };
  }
  if (opts.status) filter.status = opts.status;

  const [docs, total] = await Promise.all([
    col.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);

  return {
    runs: docs.map((d) => serializeRun(d as Record<string, unknown>)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function listJobHeartbeats(opts?: {
  job?: string;
  market?: string;
}): Promise<JobHeartbeatRow[]> {
  const col = jobRunsCollection();
  if (!col) return [];

  const filter: Record<string, unknown> = {};
  if (opts?.job) filter.job = opts.job;
  if (opts?.market) filter.market = opts.market.toUpperCase();

  const docs = await col.find(filter).sort({ job: 1, market: 1 }).toArray();
  const tracked = new Set<string>(OPS_TRACKED_HEARTBEAT_JOBS);
  return docs
    .map((d) => serializeJob(d as Record<string, unknown>))
    .filter((row) => tracked.has(row.job));
}

function marketRowDetail(row: Record<string, unknown>): string {
  if (row.error) return String(row.error);
  if (row.aborted) return String(row.abortReason ?? 'Cycle aborted');
  const err = Number(row.err ?? 0);
  const ok = Number(row.ok ?? 0);
  const skip = Number(row.skip ?? row.not_due ?? 0);
  if (err > 0) return `${err} errors, ${ok} ok, ${skip} skipped`;
  if (Number(row.scrape_failed ?? 0) > 0) {
    return `${row.scrape_failed} scrape failures (see summary)`;
  }
  return 'Failed with no error message recorded';
}

function asMarketMap(
  data: Record<string, unknown>,
): Record<string, Record<string, unknown>> | null {
  const nested = data.markets;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, Record<string, unknown>>;
  }

  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const looksLikeMarketMap = entries.every(([, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return (
      'ok' in row ||
      'err' in row ||
      'aborted' in row ||
      'processed' in row ||
      'error' in row ||
      'updated' in row
    );
  });

  return looksLikeMarketMap ? (data as Record<string, Record<string, unknown>>) : null;
}

function extractCycleIssues(summary: Record<string, unknown>): Array<{
  market: string;
  cycle: string;
  ok: number;
  err: number;
  skip: number;
  detail: string;
}> {
  const issues: Array<{
    market: string;
    cycle: string;
    ok: number;
    err: number;
    skip: number;
    detail: string;
  }> = [];

  const markets = asMarketMap(summary);
  if (markets) {
    for (const [market, data] of Object.entries(markets)) {
      const ok = Number(data.ok ?? data.processed ?? 0);
      const err = Number(data.err ?? 0);
      const skip = Number(data.skip ?? data.not_due ?? 0);
      if (err > 0 || data.aborted || data.error) {
        issues.push({
          market,
          cycle: 'market',
          ok,
          err,
          skip,
          detail: marketRowDetail(data),
        });
      }
    }
  }

  const cycles = summary.cycles as Record<string, Record<string, unknown>> | undefined;
  if (cycles && typeof cycles === 'object') {
    for (const [cycle, data] of Object.entries(cycles)) {
      const nested = asMarketMap(data);
      if (!nested) continue;
      for (const [market, row] of Object.entries(nested)) {
        const ok = Number(row.ok ?? row.processed ?? 0);
        const err = Number(row.err ?? 0);
        const skip = Number(row.skip ?? row.not_due ?? 0);
        if (err > 0 || row.aborted || row.error) {
          issues.push({
            market,
            cycle,
            ok,
            err,
            skip,
            detail: marketRowDetail(row),
          });
        }
      }
    }
  }

  return issues;
}

export async function getOperationsOverview(forceProviderCheck = false): Promise<{
  schedule: string;
  maintenance: {
    latestFullRun: MaintenanceRunRow | null;
    latestRunsByType: Record<string, MaintenanceRunRow>;
    recentIssues: Array<{
      runId: string;
      runType: string;
      startedAt: string;
      error: string | null;
      cycleIssues: ReturnType<typeof extractCycleIssues>;
    }>;
  };
  jobHeartbeats: JobHeartbeatRow[];
  backendJobs: ReturnType<typeof getJobsStatus>;
  live: {
    activeSessions: number;
    totalSessions: number;
    endedLast24h: number;
  };
  providers: ProviderHealthCheck[];
  providerSummary: ReturnType<typeof providerSummary>;
  providersCheckedAt: string;
}> {
  const col = maintenanceCollection();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let latestFullRun: MaintenanceRunRow | null = null;
  const latestRunsByType: Record<string, MaintenanceRunRow> = {};
  const recentIssues: Array<{
    runId: string;
    runType: string;
    startedAt: string;
    error: string | null;
    cycleIssues: ReturnType<typeof extractCycleIssues>;
  }> = [];

  if (col) {
    const fullDoc = await col.findOne({ runType: 'full_maintenance' }, { sort: { startedAt: -1 } });
    if (fullDoc) latestFullRun = serializeRun(fullDoc as Record<string, unknown>);

    const runTypes = [...MAINTENANCE_RUN_TYPES];
    for (const runType of runTypes) {
      const doc = await col.findOne({ runType }, { sort: { startedAt: -1 } });
      if (doc) latestRunsByType[runType] = serializeRun(doc as Record<string, unknown>);
    }

    const failedRuns = await col
      .find({
        runType: { $in: [...MAINTENANCE_RUN_TYPES] },
        $or: [{ status: 'failed' }, { ok: false }],
      })
      .sort({ startedAt: -1 })
      .limit(25)
      .toArray();

    for (const doc of failedRuns) {
      const row = serializeRun(doc as Record<string, unknown>);
      let cycleIssues = extractCycleIssues(row.summary);
      if (row.runType === 'full_maintenance') {
        // Meta ads / promo videos no longer run inside product-maintenance.
        cycleIssues = cycleIssues.filter((c) => !LEGACY_FULL_MAINTENANCE_CYCLES.has(c.cycle));
      }

      let error = row.error;
      if (error && /meta_ads_refresh|product_promo_videos_refresh/.test(error)) {
        error = null;
      }
      if (!error && cycleIssues.length > 0) {
        error = cycleIssues
          .map((c) =>
            c.cycle === 'market'
              ? `${c.market}: ${c.detail}`
              : `${c.cycle} / ${c.market}: ${c.detail}`,
          )
          .join('\n');
      }

      if (error || cycleIssues.length > 0) {
        recentIssues.push({
          runId: row.id,
          runType: row.runType,
          startedAt: row.startedAt,
          error,
          cycleIssues,
        });
      }
      if (recentIssues.length >= 8) break;
    }
  }

  const jobHeartbeats = await listJobHeartbeats();

  let activeSessions = 0;
  let totalSessions = 0;
  let endedLast24h = 0;
  await Promise.all(
    MARKET_CODES.map(async (market) => {
      const { LiveSession } = getMarketModels(market);
      const [active, total, ended] = await Promise.all([
        LiveSession.countDocuments({ status: 'live' }),
        LiveSession.countDocuments(),
        LiveSession.countDocuments({ status: 'ended', endedAt: { $gte: oneDayAgo } }),
      ]);
      activeSessions += active;
      totalSessions += total;
      endedLast24h += ended;
    }),
  );

  const { checkedAt, providers } = await runProviderHealthChecks(forceProviderCheck);

  return {
    schedule: MAINTENANCE_SCHEDULE,
    maintenance: {
      latestFullRun,
      latestRunsByType,
      recentIssues,
    },
    jobHeartbeats,
    backendJobs: getJobsStatus(),
    live: { activeSessions, totalSessions, endedLast24h },
    providers,
    providerSummary: providerSummary(providers),
    providersCheckedAt: checkedAt,
  };
}

function topNFromAgg(
  rows: Array<{ _id: string | null; count: number }>,
  n = 25,
): Record<string, number> {
  return Object.fromEntries(
    rows
      .filter((r) => r._id)
      .sort((a, b) => b.count - a.count)
      .slice(0, n)
      .map((r) => [String(r._id), r.count]),
  );
}

export async function getInventoryAnalytics(market?: MarketCode): Promise<{
  markets: MarketCode[];
  products: {
    total: number;
    fresh24h: number;
    byStatus: Record<string, number>;
    byCategoryL1: Record<string, number>;
    byCategoryL2: Record<string, number>;
    bySource: Record<string, number>;
  };
  creatives: {
    total: number;
    fresh24h: number;
    totalVideos: number;
    bySection: Record<string, number>;
    byCategoryL1: Record<string, number>;
    byCategoryL2: Record<string, number>;
    bySource: { tiktok: number; meta: number };
    byAdType: { ads: number; organic: number; unknown: number };
  };
  live: {
    activeSessions: number;
    totalSessions: number;
    endedLast24h: number;
    byMarket: Record<string, { active: number; total: number }>;
  };
}> {
  const markets: MarketCode[] = market ? [market] : [...MARKET_CODES];
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let productTotal = 0;
  let productFresh = 0;
  const byStatus: Record<string, number> = {};
  const byCatL1: Record<string, number> = {};
  const byCatL2: Record<string, number> = {};
  const bySource: Record<string, number> = {};

  let creativeTotal = 0;
  let creativeFresh = 0;
  let totalVideos = 0;
  let tiktokCount = 0;
  let metaCount = 0;
  let adsCount = 0;
  let organicCount = 0;
  let unknownAdCount = 0;
  const bySection: Record<string, number> = {};
  const creativeCatL1: Record<string, number> = {};
  const creativeCatL2: Record<string, number> = {};

  let activeSessions = 0;
  let totalSessions = 0;
  let endedLast24h = 0;
  const liveByMarket: Record<string, { active: number; total: number }> = {};

  await Promise.all(
    markets.map(async (m) => {
      const { Product, Creative, LiveSession } = getMarketModels(m);

      const [
        pTotal,
        pFresh,
        statusAgg,
        catL1Agg,
        catL2Agg,
        sourceAgg,
        cTotal,
        cFresh,
        sectionAgg,
        cCatL1,
        cCatL2,
        metaC,
        tiktokC,
        adsC,
        organicC,
        unknownC,
        videoRows,
        liveActive,
        liveTotal,
        liveEnded,
      ] = await Promise.all([
        Product.countDocuments(),
        Product.countDocuments({ lastIngestedAt: { $gte: oneDayAgo } }),
        Product.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Product.aggregate([
          { $group: { _id: '$categoryL1', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
        ]),
        Product.aggregate([
          { $match: { categoryL2: { $nin: [null, ''] } } },
          { $group: { _id: '$categoryL2', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
        ]),
        Product.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]),
        Creative.countDocuments(),
        Creative.countDocuments({ ingestedAt: { $gte: oneDayAgo } }),
        Creative.aggregate([{ $group: { _id: '$section', count: { $sum: 1 } } }]),
        Creative.aggregate([
          { $group: { _id: '$categoryL1', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
        ]),
        Creative.aggregate([
          { $match: { categoryL2: { $nin: [null, ''] } } },
          { $group: { _id: '$categoryL2', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 30 },
        ]),
        Creative.countDocuments({ externalVideoId: { $regex: /^meta:/ } }),
        Creative.countDocuments({ externalVideoId: { $not: { $regex: /^meta:/ } } }),
        Creative.countDocuments(adminCreativeAdTypeMatch('ads')),
        Creative.countDocuments(adminCreativeAdTypeMatch('organic')),
        Creative.countDocuments({
          $nor: [CREATIVE_TOP_ADS_MATCH, CREATIVE_TRENDING_MATCH],
        }),
        Creative.aggregate([
          {
            $project: {
              videoCount: { $add: [1, { $size: { $ifNull: ['$relatedVideos', []] } }] },
            },
          },
          { $group: { _id: null, totalVideos: { $sum: '$videoCount' } } },
        ]),
        LiveSession.countDocuments({ status: 'live' }),
        LiveSession.countDocuments(),
        LiveSession.countDocuments({ status: 'ended', endedAt: { $gte: oneDayAgo } }),
      ]);

      productTotal += pTotal;
      productFresh += pFresh;
      for (const row of statusAgg) {
        const key = String(row._id ?? 'unknown');
        byStatus[key] = (byStatus[key] ?? 0) + row.count;
      }
      for (const row of catL1Agg) {
        const key = String(row._id ?? 'Uncategorized');
        byCatL1[key] = (byCatL1[key] ?? 0) + row.count;
      }
      for (const row of catL2Agg) {
        const key = String(row._id ?? 'Uncategorized');
        byCatL2[key] = (byCatL2[key] ?? 0) + row.count;
      }
      for (const row of sourceAgg) {
        const key = String(row._id ?? 'unknown');
        bySource[key] = (bySource[key] ?? 0) + row.count;
      }

      creativeTotal += cTotal;
      creativeFresh += cFresh;
      metaCount += metaC;
      tiktokCount += tiktokC;
      adsCount += adsC;
      organicCount += organicC;
      unknownAdCount += unknownC;
      totalVideos += videoRows[0]?.totalVideos ?? 0;
      for (const row of sectionAgg) {
        const key = String(row._id ?? 'unknown');
        bySection[key] = (bySection[key] ?? 0) + row.count;
      }
      for (const row of cCatL1) {
        const key = String(row._id ?? 'Uncategorized');
        creativeCatL1[key] = (creativeCatL1[key] ?? 0) + row.count;
      }
      for (const row of cCatL2) {
        const key = String(row._id ?? 'Uncategorized');
        creativeCatL2[key] = (creativeCatL2[key] ?? 0) + row.count;
      }

      activeSessions += liveActive;
      totalSessions += liveTotal;
      endedLast24h += liveEnded;
      liveByMarket[m] = { active: liveActive, total: liveTotal };
    }),
  );

  return {
    markets,
    products: {
      total: productTotal,
      fresh24h: productFresh,
      byStatus,
      byCategoryL1: topNFromAgg(
        Object.entries(byCatL1).map(([_id, count]) => ({ _id, count })),
        25,
      ),
      byCategoryL2: topNFromAgg(
        Object.entries(byCatL2).map(([_id, count]) => ({ _id, count })),
        25,
      ),
      bySource,
    },
    creatives: {
      total: creativeTotal,
      fresh24h: creativeFresh,
      totalVideos,
      bySection,
      byCategoryL1: topNFromAgg(
        Object.entries(creativeCatL1).map(([_id, count]) => ({ _id, count })),
        25,
      ),
      byCategoryL2: topNFromAgg(
        Object.entries(creativeCatL2).map(([_id, count]) => ({ _id, count })),
        25,
      ),
      bySource: { tiktok: tiktokCount, meta: metaCount },
      byAdType: { ads: adsCount, organic: organicCount, unknown: unknownAdCount },
    },
    live: {
      activeSessions,
      totalSessions,
      endedLast24h,
      byMarket: liveByMarket,
    },
  };
}

export type IngestionPeriod = 'daily' | 'weekly' | 'monthly';

export interface IngestionEntityCounts {
  products: number;
  creatives: number;
  ads: number;
  metaAds: number;
}

export interface IngestionTimeBucket {
  period: string;
  count: number;
}

export interface IngestionAnalytics {
  markets: MarketCode[];
  period: IngestionPeriod;
  range: { from: string; to: string };
  windows: {
    hours3: IngestionEntityCounts;
    hours6: IngestionEntityCounts;
    hours12: IngestionEntityCounts;
    daily: IngestionEntityCounts;
    weekly: IngestionEntityCounts;
    monthly: IngestionEntityCounts;
  };
  series: {
    products: IngestionTimeBucket[];
    creatives: IngestionTimeBucket[];
    ads: IngestionTimeBucket[];
    metaAds: IngestionTimeBucket[];
  };
}

const INGESTION_DATE_FORMAT: Record<IngestionPeriod, string> = {
  daily: '%Y-%m-%d',
  weekly: '%G-W%V',
  monthly: '%Y-%m',
};

const DEFAULT_BUCKETS: Record<IngestionPeriod, number> = {
  daily: 30,
  weekly: 12,
  monthly: 12,
};

type IngestionEntityKey = keyof IngestionEntityCounts;

const INGESTION_ENTITY_CONFIG: Record<
  IngestionEntityKey,
  { dateField: string; isProduct: boolean; extraMatch: Record<string, unknown> }
> = {
  products: { dateField: 'lastIngestedAt', isProduct: true, extraMatch: {} },
  // Match Creatives page (organic only) — not all creatives, or Ads duplicates the count.
  creatives: {
    dateField: 'ingestedAt',
    isProduct: false,
    extraMatch: adminCreativeAdTypeMatch('organic'),
  },
  ads: { dateField: 'ingestedAt', isProduct: false, extraMatch: adminCreativeAdTypeMatch('ads') },
  metaAds: { dateField: 'ingestedAt', isProduct: false, extraMatch: CREATIVE_META_ADS_MATCH },
};

function periodStartDate(period: IngestionPeriod, buckets: number): Date {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (period === 'daily') return new Date(now - buckets * dayMs);
  if (period === 'weekly') return new Date(now - buckets * 7 * dayMs);
  return new Date(now - buckets * 30 * dayMs);
}

type IngestionWindowKey = keyof IngestionAnalytics['windows'];

function windowStart(window: IngestionWindowKey): Date {
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (window === 'hours3') return new Date(Date.now() - 3 * hourMs);
  if (window === 'hours6') return new Date(Date.now() - 6 * hourMs);
  if (window === 'hours12') return new Date(Date.now() - 12 * hourMs);
  if (window === 'daily') return new Date(Date.now() - dayMs);
  if (window === 'weekly') return new Date(Date.now() - 7 * dayMs);
  return new Date(Date.now() - 30 * dayMs);
}

async function countIngestedForEntity(
  markets: MarketCode[],
  entity: IngestionEntityKey,
  since: Date,
): Promise<number> {
  const { dateField, isProduct, extraMatch } = INGESTION_ENTITY_CONFIG[entity];
  const match = {
    [dateField]: { $gte: since },
    ...extraMatch,
  };

  const counts = await Promise.all(
    markets.map(async (market) => {
      const models = getMarketModels(market);
      const Model = isProduct ? models.Product : models.Creative;
      return Model.countDocuments(match);
    }),
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

async function aggregateIngestionSeries(
  markets: MarketCode[],
  entity: IngestionEntityKey,
  period: IngestionPeriod,
  startDate: Date,
): Promise<IngestionTimeBucket[]> {
  const { dateField, isProduct, extraMatch } = INGESTION_ENTITY_CONFIG[entity];
  const merged = new Map<string, number>();

  await Promise.all(
    markets.map(async (market) => {
      const models = getMarketModels(market);
      const Model = isProduct ? models.Product : models.Creative;
      const rows = await Model.aggregate([
        {
          $match: {
            [dateField]: { $gte: startDate },
            ...extraMatch,
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: INGESTION_DATE_FORMAT[period],
                date: `$${dateField}`,
                timezone: 'UTC',
              },
            },
            count: { $sum: 1 },
          },
        },
      ]);
      for (const row of rows) {
        const key = String(row._id);
        merged.set(key, (merged.get(key) ?? 0) + row.count);
      }
    }),
  );

  return Array.from(merged.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketPeriod, count]) => ({ period: bucketPeriod, count }));
}

async function buildIngestionWindowCounts(
  markets: MarketCode[],
  since: Date,
): Promise<IngestionEntityCounts> {
  const [products, creatives, ads, metaAds] = await Promise.all([
    countIngestedForEntity(markets, 'products', since),
    countIngestedForEntity(markets, 'creatives', since),
    countIngestedForEntity(markets, 'ads', since),
    countIngestedForEntity(markets, 'metaAds', since),
  ]);
  return { products, creatives, ads, metaAds };
}

export async function getIngestionAnalytics(opts: {
  market?: MarketCode;
  period?: IngestionPeriod;
  buckets?: number;
}): Promise<IngestionAnalytics> {
  const markets: MarketCode[] = opts.market ? [opts.market] : [...MARKET_CODES];
  const period = opts.period ?? 'daily';
  const bucketCount = Math.min(Math.max(opts.buckets ?? DEFAULT_BUCKETS[period], 1), 90);
  const startDate = periodStartDate(period, bucketCount);

  const [
    hours3Window,
    hours6Window,
    hours12Window,
    dailyWindow,
    weeklyWindow,
    monthlyWindow,
    products,
    creatives,
    ads,
    metaAds,
  ] = await Promise.all([
    buildIngestionWindowCounts(markets, windowStart('hours3')),
    buildIngestionWindowCounts(markets, windowStart('hours6')),
    buildIngestionWindowCounts(markets, windowStart('hours12')),
    buildIngestionWindowCounts(markets, windowStart('daily')),
    buildIngestionWindowCounts(markets, windowStart('weekly')),
    buildIngestionWindowCounts(markets, windowStart('monthly')),
    aggregateIngestionSeries(markets, 'products', period, startDate),
    aggregateIngestionSeries(markets, 'creatives', period, startDate),
    aggregateIngestionSeries(markets, 'ads', period, startDate),
    aggregateIngestionSeries(markets, 'metaAds', period, startDate),
  ]);

  return {
    markets,
    period,
    range: { from: startDate.toISOString(), to: new Date().toISOString() },
    windows: {
      hours3: hours3Window,
      hours6: hours6Window,
      hours12: hours12Window,
      daily: dailyWindow,
      weekly: weeklyWindow,
      monthly: monthlyWindow,
    },
    series: { products, creatives, ads, metaAds },
  };
}
