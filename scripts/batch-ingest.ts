import 'dotenv/config';
import { connectMongo } from '../src/db/client';
import { HashtagIngestionPipeline } from '../src/ingestion/ensemble/hashtag-ingestion.pipeline';
import { Product } from '../src/models/product.model';
import { logger } from '../src/logger';

async function main() {
  const CHUNK_SIZE = 10;
  const TOTAL_TO_ADD = 70;
  
  console.log('\n🚀 ValidDs — Chunked Real-Time Ingestion (70 Products)');
  console.log(`Processing in blocks of ${CHUNK_SIZE}...`);
  console.log('====================================================\n');

  try {
    console.log('Connecting to MongoDB...');
    await connectMongo();
    console.log('✓ Connected\n');

    const startCount = await Product.countDocuments({ status: 'active' });
    const targetCount = startCount + TOTAL_TO_ADD;
    
    console.log(`Initial Count: ${startCount}`);
    console.log(`Goal:          ${targetCount} products\n`);

    const pipeline = new HashtagIngestionPipeline();
    let currentCount = startCount;
    let productsInCurrentChunk = 0;
    let cycle = 1;

    while (currentCount < targetCount) {
      console.log(`\n[Cycle #${cycle}] Researching viral products...`);
      
      const result = await pipeline.run();
      
      // Update global count
      const newCount = await Product.countDocuments({ status: 'active' });
      const addedThisCycle = newCount - currentCount;
      currentCount = newCount;
      productsInCurrentChunk += addedThisCycle;

      console.log(`- Cycle #${cycle} complete: +${addedThisCycle} real products added.`);
      
      // Check if we hit a 10-product chunk
      if (productsInCurrentChunk >= CHUNK_SIZE || currentCount >= targetCount) {
        console.log(`\n----------------------------------------------------`);
        console.log(`📦 BATCH COMPLETE: Added block of ${productsInCurrentChunk} products.`);
        console.log(`📈 TOTAL PROGRESS: ${currentCount - startCount} / ${TOTAL_TO_ADD}`);
        console.log(`----------------------------------------------------\n`);
        productsInCurrentChunk = 0; // Reset chunk tracker
      }

      if (addedThisCycle === 0 && result.errors.length > 5) {
        console.warn('⚠️ No new products found. Throttling or low-intent cycle. Pausing 5s...');
        await new Promise(r => setTimeout(r, 5000));
      }

      cycle++;
      if (cycle > 100) break; // Infinite loop safety
    }

    console.log('\n====================================================');
    console.log(`✅ CHUNKED INGESTION SUCCESSFUL!`);
    console.log(`Final Total: ${currentCount} products.`);

  } catch (err) {
    logger.error('Batch ingestion failed', err);
    console.error('❌ Fatal error during ingestion:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
