/**
 * Backfill estimated per-video GMV on all creatives.
 *
 * Allocates parent product GMV across creatives on the same SKU by view share.
 * Safe to re-run — recomputes from current productTotalGmv + metrics.viewCount.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/backfill-estimated-video-gmv.ts
 *   npx ts-node --transpile-only scripts/backfill-estimated-video-gmv.ts --dry-run
 *   npx ts-node --transpile-only scripts/backfill-estimated-video-gmv.ts --market US
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { getMarketModels } from '../src/models/market-models.factory';
import { syncEstimatedVideoGmvForProduct } from '../src/services/sync-estimated-video-gmv.service';
import { MARKET_CODES, type MarketCode, isValidMarket } from '../src/utils/markets';

function parseMarkets(): MarketCode[] {
  const idx = process.argv.indexOf('--market');
  if (idx === -1) return [...MARKET_CODES];
  const raw = process.argv[idx + 1]?.toUpperCase();
  if (!raw || !isValidMarket(raw)) {
    throw new Error(`Invalid --market value: ${raw ?? '(missing)'}`);
  }
  return [raw];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const markets = parseMarkets();

  await connectMongo();

  let productsProcessed = 0;
  let creativesTouched = 0;

  for (const market of markets) {
    const { Creative } = getMarketModels(market);
    const productIds = await Creative.distinct('productId');
    console.log(`[${market}] ${productIds.length} product(s) with creatives`);

    for (const productId of productIds) {
      productsProcessed += 1;
      if (dryRun) {
        const count = await Creative.countDocuments({ productId });
        creativesTouched += count;
        continue;
      }

      const modified = await syncEstimatedVideoGmvForProduct(productId, Creative);
      creativesTouched += modified;
      if (productsProcessed % 250 === 0) {
        console.log(
          `[${market}] progress products=${productsProcessed}/${productIds.length} creatives=${creativesTouched}`,
        );
      }
    }
  }

  console.log(
    `Done. markets=${markets.join(',')} products=${productsProcessed} creatives=${creativesTouched} dryRun=${dryRun}`,
  );
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectMongo();
  } catch {
    // ignore
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});
