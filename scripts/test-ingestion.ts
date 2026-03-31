/**
 * Manual ingestion test script.
 *
 * Usage: npm run test-ingestion
 *
 * Runs one full ingestion cycle and logs the results.
 * Useful for testing the Creative Center scraper and AI extractor
 * without waiting for the scheduled job.
 */

import 'dotenv/config';
import { connectMongo } from '../src/db/client';
import { getRedisClient } from '../src/cache/redis.client';
import { runProductRefreshJob } from '../src/jobs/product-refresh.job';

async function main() {
  console.log('\n🚀 ValidDs — Manual Ingestion Test\n');

  try {
    console.log('Connecting to MongoDB...');
    await connectMongo();
    console.log('✓ MongoDB connected\n');

    if (process.env.REDIS_URL) {
      console.log('Connecting to Redis...');
      const redis = getRedisClient();
      await redis.ping();
      console.log('✓ Redis connected\n');
    }

    console.log('Starting ingestion cycle...\n');
    await runProductRefreshJob();

    console.log('\n✓ Ingestion test complete\n');
  } catch (err) {
    console.error('\n✗ Ingestion test failed:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
