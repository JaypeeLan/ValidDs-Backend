import 'dotenv/config';
import mongoose from 'mongoose';
import { runEchoTikPipelineJob } from '../src/jobs/index';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string, {
    dbName: process.env.MONGODB_DB_NAME || 'validds'
  });
  console.log('Connected to DB:', process.env.MONGODB_DB_NAME || 'validds');

  const regions = ['US', 'BR', 'MX', 'GB', 'FR', 'DE', 'ES', 'IT', 'AU', 'NZ'];

  for (const region of regions) {
    console.log(`\n--- Running ingestion for ${region} ---`);
    try {
      await runEchoTikPipelineJob(region);
    } catch (err: any) {
      console.error(`Failed for ${region}:`, err.message);
    }
  }

  console.log('\nAll regions processed.');
  process.exit(0);
}

run().catch(console.error);
