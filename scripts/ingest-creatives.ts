/**
 * Manual creative ingestion script.
 *
 * Default mode mirrors the scheduled creative ingestion job (runs every 12 h
 * at 00:00 / 12:00 Africa/Lagos, adds up to CREATIVES_PER_RUN new videos per
 * run). Because `CreativeService.mapAndSave` now overwrites existing slots,
 * this also refreshes TikTok CDN signatures for creatives it revisits.
 *
 * Refresh mode walks every creative (or a single one with `--only-id=`) and
 * re-fetches fresh signed URLs from EnsembleData's /post/info endpoint for
 * every video slot (root + relatedVideos) — useful right after a long outage
 * when the lazy-refresh-on-proxy-miss path would take too long to converge.
 *
 * Usage:
 *   npm run ingest-creatives                          # 500/run ingestion
 *   npm run ingest-creatives -- --refresh             # refresh URLs on every creative
 *   npm run ingest-creatives -- --refresh --limit=50
 *   npm run ingest-creatives -- --refresh --only-id=<objectId>
 *   npm run ingest-creatives -- --refresh --concurrency=3
 *
 * Notes:
 *   - EnsembleData is rate-limited inside the client (~2 s between calls).
 *   - A full refresh costs ~ (1 + relatedVideos.length) API calls per creative.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { runCreativeIngestionJob } from '../src/jobs';
import { Creative } from '../src/models/creative.model';
import { CreativeService } from '../src/services/creative.service';
import { logger } from '../src/logger';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function runIngest(): Promise<void> {
  console.log('\nValidDs — Manual Creative Ingestion');
  console.log('====================================');
  console.log('Mode: ingest (500/run cadence)\n');

  const startCount = await Creative.countDocuments();
  console.log(`Total creatives before run: ${startCount}`);

  await runCreativeIngestionJob();

  const endCount = await Creative.countDocuments();
  console.log(`Total creatives after run:  ${endCount} (delta: ${endCount - startCount})`);
}

async function runRefresh(): Promise<void> {
  const limit = Number(parseFlag('limit') || 0);
  const concurrency = Math.max(1, Number(parseFlag('concurrency') || 2));
  const onlyId = parseFlag('only-id');

  console.log('\nValidDs — Manual Creative URL Refresh');
  console.log('====================================');
  console.log(`Mode: refresh`);
  console.log(`Concurrency: ${concurrency}`);
  if (onlyId) console.log(`Only ID: ${onlyId}`);
  if (limit) console.log(`Limit: ${limit}`);
  console.log('');

  const query = onlyId ? { _id: new mongoose.Types.ObjectId(onlyId) } : {};
  const cursor = Creative.find(query).select('_id').lean().cursor();

  let totalDocs = 0;
  let totalScanned = 0;
  let totalRefreshed = 0;

  const workers: Promise<void>[] = [];
  const queue: string[] = [];
  let done = false;

  const pump = async (): Promise<void> => {
    while (!done || queue.length > 0) {
      const id = queue.shift();
      if (!id) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      try {
        const res = await CreativeService.refreshAllSlotsForCreative(id);
        totalScanned += res.scanned;
        totalRefreshed += res.refreshed;
        console.log(
          `  [${totalDocs}] ${id} — ${res.refreshed}/${res.slots} slots refreshed`
        );
      } catch (err) {
        logger.warn('refresh failed for creative', { id, err: String(err) });
      }
    }
  };

  for (let i = 0; i < concurrency; i += 1) workers.push(pump());

  for await (const doc of cursor) {
    totalDocs += 1;
    queue.push(String(doc._id));
    if (limit && totalDocs >= limit) break;
    while (queue.length > concurrency * 2) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  done = true;
  await Promise.all(workers);

  console.log('');
  console.log(`Processed creatives: ${totalDocs}`);
  console.log(`Slots scanned:       ${totalScanned}`);
  console.log(`Slots refreshed:     ${totalRefreshed}`);
}

async function main(): Promise<void> {
  await connectMongo();
  console.log('Connected to MongoDB.');

  if (hasFlag('refresh')) {
    await runRefresh();
  } else {
    await runIngest();
  }
}

main()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nCreative script failed:', err);
    logger.error('ingest-creatives script failed', { err: String(err) });
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
