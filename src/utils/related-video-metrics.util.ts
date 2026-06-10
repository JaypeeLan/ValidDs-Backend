import type { Model } from 'mongoose';
import type { ICreativeDocument, IVideoMetrics } from '../types/creative.types';
import { ScrapeCreatorsService } from '../services/scrapecreators.service';
import { sanitizeVideoMetrics } from './video-metrics.util';

const LIVE_FETCH_LIMIT = 8;
const LIVE_FETCH_MAX_PAGES = 3;

export function isZeroVideoMetrics(metrics: Partial<IVideoMetrics> | null | undefined): boolean {
  if (!metrics || typeof metrics !== 'object') return true;
  return (
    Number(metrics.viewCount) <= 0 &&
    Number(metrics.likeCount) <= 0 &&
    Number(metrics.commentCount) <= 0 &&
    Number(metrics.shareCount) <= 0
  );
}

export function collectRelatedVideoExternalIds(creative: Record<string, unknown>): string[] {
  const related = creative.relatedVideos;
  if (!Array.isArray(related)) return [];
  const ids: string[] = [];
  for (const rv of related) {
    if (!rv || typeof rv !== 'object') continue;
    const eid = String((rv as { externalVideoId?: string }).externalVideoId ?? '').trim();
    if (/^\d+$/.test(eid)) ids.push(eid);
  }
  return ids;
}

/** Primary creative rows keyed by TikTok video id (non-zero metrics only). */
export async function loadVideoMetricsByExternalId(
  videoIds: string[],
  creativeModel: Model<ICreativeDocument>,
): Promise<Map<string, IVideoMetrics>> {
  const ids = [...new Set(videoIds.filter((id) => /^\d+$/.test(id)))];
  if (!ids.length) return new Map();

  const rows = await creativeModel
    .aggregate<{ _id: string; metrics: IVideoMetrics }>([
      {
        $match: {
          externalVideoId: { $in: ids },
          'metrics.viewCount': { $gt: 0 },
        },
      },
      { $project: { _id: '$externalVideoId', metrics: 1 } },
    ])
    .option({ maxTimeMS: 15_000 });

  const map = new Map<string, IVideoMetrics>();
  for (const row of rows) {
    const id = String(row._id ?? '').trim();
    if (!id || !row.metrics || isZeroVideoMetrics(row.metrics)) continue;
    map.set(id, sanitizeVideoMetrics(row.metrics));
  }
  return map;
}

/** Fill zeroed embedded related slots from other creative docs for the same video id. */
export function enrichRelatedVideosMetricsInPlace(
  creative: Record<string, unknown>,
  metricsById: Map<string, IVideoMetrics>,
): void {
  const related = creative.relatedVideos;
  if (!Array.isArray(related) || !metricsById.size) return;

  for (const rv of related) {
    if (!rv || typeof rv !== 'object') continue;
    const row = rv as Record<string, unknown>;
    if (!isZeroVideoMetrics(row.metrics as Partial<IVideoMetrics> | undefined)) continue;
    const eid = String(row.externalVideoId ?? '').trim();
    const resolved = metricsById.get(eid);
    if (resolved) row.metrics = resolved;
  }
}

async function fetchLiveMetricsForSlot(
  row: Record<string, unknown>,
): Promise<IVideoMetrics | null> {
  const creator = row.creator as { handle?: string; region?: string } | undefined;
  const handle = String(creator?.handle ?? '')
    .replace(/^@/, '')
    .trim();
  const eid = String(row.externalVideoId ?? '').trim();
  if (!handle || !/^\d+$/.test(eid)) return null;
  if (!ScrapeCreatorsService.isConfigured()) return null;
  return ScrapeCreatorsService.findAwemeEngagement(handle, eid, {
    region: String(creator?.region ?? 'US').trim() || 'US',
    maxPages: LIVE_FETCH_MAX_PAGES,
  });
}

export async function enrichCreativeRelatedVideoMetrics(
  creative: Record<string, unknown>,
  creativeModel: Model<ICreativeDocument>,
): Promise<void> {
  const ids = collectRelatedVideoExternalIds(creative);
  if (!ids.length) return;
  const metricsById = await loadVideoMetricsByExternalId(ids, creativeModel);
  enrichRelatedVideosMetricsInPlace(creative, metricsById);

  const related = creative.relatedVideos;
  if (!Array.isArray(related) || !ScrapeCreatorsService.isConfigured()) return;

  const pending: Record<string, unknown>[] = [];
  for (const rv of related) {
    if (pending.length >= LIVE_FETCH_LIMIT) break;
    if (!rv || typeof rv !== 'object') continue;
    const row = rv as Record<string, unknown>;
    if (!isZeroVideoMetrics(row.metrics as Partial<IVideoMetrics> | undefined)) continue;
    pending.push(row);
  }

  if (!pending.length) return;

  const results = await Promise.all(pending.map((row) => fetchLiveMetricsForSlot(row)));
  for (let i = 0; i < pending.length; i += 1) {
    const live = results[i];
    if (live) pending[i].metrics = live;
  }
}
