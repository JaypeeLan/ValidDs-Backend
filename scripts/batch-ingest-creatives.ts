import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { CreativeService } from '../src/services/creative.service';
import { logger } from '../src/logger';

async function main() {
  const KWARGS = process.argv.slice(2);
  const keyword = KWARGS[0] || 'viral products';
  const limit = parseInt(KWARGS[1], 10) || 10;
  
  console.log('\n🎥 ValidDs — Test Standalone Creative Ingestion');
  console.log(`Keyword: "${keyword}" | Limit: ${limit}`);
  console.log('====================================================\n');

  try {
    console.log('Connecting to MongoDB...');
    await connectMongo();
    console.log('✓ Connected\n');

    console.log(`Ingesting creatives for keyword: "${keyword}"...`);
    const result = await CreativeService.ingestByKeyword(keyword, { limit });
    
    console.log(`\n====================================================`);
    console.log(`✅ INGESTION SUCCESSFUL!`);
    console.log(`Linked to Product ID: ${result.productId} (${result.productTitle})`);
    console.log(`Creatives Saved: ${result.saved}`);
  } catch (err) {
    logger.error('Creative batch ingestion failed', err);
    console.error('❌ Fatal error during ingestion:', err);
    process.exit(1);
  } finally {
    await disconnectMongo();
    process.exit(0);
  }
}

main();
