import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { Product } from '../src/models/product.model';
import { logger } from '../src/logger';

async function main(): Promise<void> {
  const jsonPath = path.resolve(process.cwd(), 'products_db_ready.json');
  const raw = await fs.readFile(jsonPath, 'utf8');
  const payload = JSON.parse(raw);
  const docs = Array.isArray(payload) ? payload : [];

  await connectMongo();
  try {
    const before = await Product.countDocuments({});
    await Product.insertMany(docs, { ordered: false });
    const after = await Product.countDocuments({});
    console.log(`Products before import: ${before}`);
    console.log(`Products inserted from file: ${docs.length}`);
    console.log(`Products after import: ${after}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((err) => {
  logger.error('Import products JSON failed', err);
  console.error(err);
  process.exit(1);
});
