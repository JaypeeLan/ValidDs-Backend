import 'dotenv/config';
import { logger } from '../src/logger';
import { runProductIngestionJob } from '../src/jobs';

async function main(): Promise<void> {
  logger.info('Running manual product ingestion');
  await runProductIngestionJob();
  logger.info('Manual product ingestion finished');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Manual product ingestion failed', { err: String(err) });
    process.exit(1);
  });
