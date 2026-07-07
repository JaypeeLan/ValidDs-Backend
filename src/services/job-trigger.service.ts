import mongoose from 'mongoose';
import { AppError } from '../middleware/error.middleware';
import type { MarketCode } from '../utils/markets';

export type JobTriggerStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TriggerableJob {
  job: string;
  service: 'product-maintenance' | 'scraper';
  label: string;
  description: string;
}

export const TRIGGERABLE_JOBS: TriggerableJob[] = [
  {
    job: 'full_maintenance',
    service: 'product-maintenance',
    label: 'Full daily maintenance',
    description: 'Metrics → prices (meta ads + promo videos run in scraper)',
  },
  {
    job: 'product_metrics_refresh',
    service: 'product-maintenance',
    label: 'Product metrics',
    description: 'Refresh soldCount, GMV, and revenue trends',
  },
  {
    job: 'product_prices_refresh',
    service: 'product-maintenance',
    label: 'Product prices',
    description: 'Validate live TikTok Shop PDP prices (Playwright)',
  },
  {
    job: 'meta_ads_refresh',
    service: 'scraper',
    label: 'Meta ads refresh',
    description: 'Search Meta Ad Library and attach creatives',
  },
  {
    job: 'product_promo_videos_refresh',
    service: 'scraper',
    label: 'Promo videos',
    description: 'Discover extra TikTok promo clips per product',
  },
  {
    job: 'discovery_sections_refresh',
    service: 'product-maintenance',
    label: 'Discovery sections',
    description: 'Refresh new-3d / new-7d discovery tags',
  },
  {
    job: 'ensure_videos',
    service: 'scraper',
    label: 'Ensure product videos',
    description: 'Upload/sync TikTok + Meta MP4s to S3',
  },
];

const JOB_BY_NAME = new Map(TRIGGERABLE_JOBS.map((j) => [j.job, j]));

function triggersCollection() {
  return mongoose.connection.db?.collection('job_triggers') ?? null;
}

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export interface JobTriggerRow {
  id: string;
  job: string;
  service: string;
  market: string;
  status: JobTriggerStatus;
  requestedAt: string;
  requestedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

function serializeTrigger(doc: Record<string, unknown>): JobTriggerRow {
  return {
    id: String(doc._id),
    job: String(doc.job ?? ''),
    service: String(doc.service ?? ''),
    market: String(doc.market ?? 'US'),
    status: String(doc.status ?? 'pending') as JobTriggerStatus,
    requestedAt: toIso(doc.requestedAt) ?? new Date(0).toISOString(),
    requestedBy: doc.requestedBy ? String(doc.requestedBy) : null,
    startedAt: toIso(doc.startedAt),
    finishedAt: toIso(doc.finishedAt),
    error: doc.error ? String(doc.error) : null,
    result: (doc.result as Record<string, unknown>) ?? null,
  };
}

export function listTriggerableJobs(): TriggerableJob[] {
  return TRIGGERABLE_JOBS;
}

export async function queueJobTrigger(opts: {
  job: string;
  market?: MarketCode;
  requestedBy?: string | null;
}): Promise<JobTriggerRow> {
  const meta = JOB_BY_NAME.get(opts.job);
  if (!meta) {
    throw new AppError(400, `Unknown job: ${opts.job}`, 'INVALID_JOB');
  }

  const col = triggersCollection();
  if (!col) {
    throw new AppError(503, 'Database not connected', 'DB_UNAVAILABLE');
  }

  const market = (opts.market ?? 'US').toUpperCase();

  const existing = await col.findOne({
    job: opts.job,
    market,
    service: meta.service,
    status: { $in: ['pending', 'running'] },
  });
  if (existing) {
    throw new AppError(
      409,
      `${meta.label} is already queued or running for ${market}`,
      'JOB_ALREADY_QUEUED',
    );
  }

  const now = new Date();
  const doc = {
    job: opts.job,
    service: meta.service,
    market,
    status: 'pending' as const,
    requestedAt: now,
    requestedBy: opts.requestedBy ?? null,
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
  };

  const result = await col.insertOne(doc);
  return serializeTrigger({ ...doc, _id: result.insertedId });
}

export async function listJobTriggers(opts?: {
  limit?: number;
  status?: JobTriggerStatus;
}): Promise<JobTriggerRow[]> {
  const col = triggersCollection();
  if (!col) return [];

  const filter: Record<string, unknown> = {};
  if (opts?.status) filter.status = opts.status;

  const limit = Math.min(opts?.limit ?? 20, 50);
  const docs = await col.find(filter).sort({ requestedAt: -1 }).limit(limit).toArray();
  return docs.map((d) => serializeTrigger(d as Record<string, unknown>));
}
