/**
 * Hashtag Ingestion Pipeline — runs once at deployment to seed the DB.
 *
 * Called by `npm start` before `node dist/server.js` so products are
 * available immediately when the server starts accepting traffic.
 *
 * The in-process cron (every 48 h) keeps data fresh after that.
 *
 * Manual usage: npm run hashtag-pipeline
 */

import 'dotenv/config';

import { connectMongo } from '../db/client';
import { HashtagIngestionPipeline } from '../ingestion/ensemble/hashtag-ingestion.pipeline';
import { logger } from '../logger';

const log = logger.child({ module: 'run-hashtag-pipeline' });

async function main() {
  log.info('🚀 Hashtag Ingestion Pipeline — seeding DB on deployment');

  try {
    await connectMongo();
    log.info('MongoDB connected');

    const pipeline = new HashtagIngestionPipeline();
    const result = await pipeline.run();

    log.info('Pipeline complete', {
      postsCollected: result.postsCollected,
      postsFiltered: result.postsFiltered,
      aiExtractionsDone: result.aiExtractionsDone,
      teemdropHits: result.teemdropHits,
      rainforestHits: result.rainforestHits,
      dbUpserts: result.dbUpserts,
      errors: result.errors.length,
      durationMs: result.durationMs,
    });

    if (result.errors.length > 0) {
      log.warn('Pipeline completed with errors', { errors: result.errors });
    }
  } catch (err) {
    log.error('Pipeline failed fatally', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
