/**
 * Backfill S3 shop logos for products (validates CDN URLs, fetches fresh logo on failure).
 *
 *   npx ts-node --transpile-only scripts/cache-shop-avatars.ts --market US
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { getMarketModels } from '../src/models/market-models.factory';
import { persistShopAvatarOnProduct } from '../src/services/creator-avatar-cache.service';
import { toMarketCode } from '../src/utils/markets';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const market = toMarketCode(
    String(
      args.find((a) => a.startsWith('--market='))?.split('=')[1] ??
        (args.includes('--market') ? args[args.indexOf('--market') + 1] : 'US'),
    ).toUpperCase(),
  );
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0) || 0;

  await connectMongo();
  const { Product, Creative } = getMarketModels(market);
  const cursor = Product.find({
    shopName: { $type: 'string', $regex: /\S/ },
    $or: [
      { shopAvatarUrl: { $type: 'string', $regex: /^https:\/\// } },
      { shopUrl: { $type: 'string', $regex: /^https:\/\// } },
    ],
  })
    .select({ _id: 1, shopName: 1 })
    .lean()
    .cursor();

  const seenShops = new Set<string>();
  let n = 0;
  let s3Ok = 0;
  let failed = 0;
  let skippedDup = 0;

  for await (const row of cursor) {
    const shopName = String((row as { shopName?: string }).shopName ?? '').trim();
    const dedupeKey = `${market}:${shopName.toLowerCase()}`;
    if (!shopName || seenShops.has(dedupeKey)) {
      skippedDup += 1;
      continue;
    }
    seenShops.add(dedupeKey);

    if (limit > 0 && n >= limit) break;
    n += 1;

    try {
      const r = await persistShopAvatarOnProduct(String(row._id), Product, Creative, {
        market,
        forceRefresh: args.includes('--force'),
      });
      if (r?.shopAvatarS3Key) s3Ok += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.warn(`  skip ${shopName} (${row._id}):`, String(err));
    }

    if (n % 25 === 0) {
      console.log(`  ${n} shops — S3: ${s3Ok}, failed: ${failed}, dup-skipped: ${skippedDup}`);
    }
  }

  console.log(
    `Done (${market}). ${n} unique shops — ${s3Ok} on S3, ${failed} failed, ${skippedDup} duplicate rows skipped.`,
  );
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
