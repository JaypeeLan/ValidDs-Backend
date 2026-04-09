/**
 * Manual Hashtag Ingestion Pipeline script.
 *
 * Usage: npm run hashtag-pipeline
 * Or:    npx ts-node scripts/run-hashtag-pipeline.ts
 *
 * Runs one full cycle of the EnsembleData -> Gemini AI -> Rainforest pipeline
 * and logs every step of the process.
 */

import 'dotenv/config';

// Force debug logging for explicit visibility of every inner step
process.env.LOG_LEVEL = 'debug';
process.env.LOG_PRETTY = 'true';

import { connectMongo } from '../src/db/client';
import { HashtagIngestionPipeline } from '../src/ingestion/ensemble/hashtag-ingestion.pipeline';
import { logger } from '../src/logger';

async function main() {
  console.log('\n🚀 ValidDs — Manual Hashtag Ingestion Pipeline Test\n');

  try {
    console.log('Connecting to MongoDB...');
    await connectMongo();
    console.log('✓ MongoDB connected\n');

    console.log('Starting exact ingestion cycle...\n');
    const pipeline = new HashtagIngestionPipeline();
    const result = await pipeline.run();

    console.log('\n=============================================');
    console.log('✓ Pipeline Test Complete');
    console.log('=============================================');
    console.log(`Posts Collected:        ${result.postsCollected}`);
    console.log(`Low-View Posts Skipped: ${result.postsFiltered}`);
    console.log(`AI Extractions Run:     ${result.aiExtractionsDone}`);
    console.log(`Amazon Rainforest Hits: ${result.rainforestHits}`);
    console.log(`Database Upserts:       ${result.dbUpserts}`);
    console.log(`Errors Encountered:     ${result.errors.length}`);
    console.log(`Total Duration:         ${(result.durationMs / 1000).toFixed(2)}s`);
    
    if (result.errors.length > 0) {
      console.log('\nPipeline Warnings/Errors:');
      result.errors.forEach(err => console.log(' -', err));
    }

  } catch (err) {
    logger.error('Pipeline manually terminated due to fatal error:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
