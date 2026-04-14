import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { ProductService } from '../src/services/product.service';
import { logger } from '../src/logger';

async function main(): Promise<void> {
  try {
    await connectMongo();
    logger.info('Starting database cleanup for products');

    const { genericDeleted, duplicatesDeleted } = await ProductService.cleanupProducts();

    logger.info('Product cleanup complete', {
      genericDeleted,
      duplicatesDeleted,
    });

    console.log('Product cleanup complete:');
    console.log(`  Generic products deleted: ${genericDeleted}`);
    console.log(`  Duplicate products deleted: ${duplicatesDeleted}`);
  } catch (err) {
    logger.error('Product cleanup failed', err);
    console.error('Product cleanup failed:', err);
    process.exit(1);
  } finally {
    await disconnectMongo();
  }
}

main();
