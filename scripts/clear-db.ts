import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { Product } from '../src/models/product.model';
import { Creative } from '../src/models/creative.model';
import { logger } from '../src/logger';

async function main(): Promise<void> {
  console.log('\n🗑️ ValidDs — Database Reset');
  console.log('====================================');

  try {
    console.log('Connecting to MongoDB...');
    await connectMongo();
    console.log('✓ Connected\n');

    console.log('Clearing Products collection...');
    const resultP = await Product.deleteMany({});
    console.log(`✓ Deleted ${resultP.deletedCount} products`);

    console.log('Clearing Creatives collection...');
    const resultC = await Creative.deleteMany({});
    console.log(`✓ Deleted ${resultC.deletedCount} creatives`);

    console.log('\n====================================');
    console.log('✅ Database clear complete');
  } catch (err) {
    logger.error('Database clear failed', err);
    console.error('❌ Error during cleanup:', err);
    process.exit(1);
  } finally {
    await disconnectMongo();
  }
}

main();
