/**
 * Pre-warms the Redis image URL cache for all EchoTik products in the DB.
 *
 * Exchanges each product's original volces.com cover URLs for 24-hour temp URLs
 * and stores them in Redis (20-hour TTL) so the first API request per product
 * does not have to wait on the EchoTik API.
 *
 * Usage:
 *   npx ts-node scripts/prewarm-echotik-images.ts
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { getRedisClient } from '../src/cache/redis.client';
import { Product } from '../src/models/product.model';
import { EchoTikClient } from '../src/ingestion/echotik/echotik.client';
import { CacheService } from '../src/cache/cache.service';

const ECHOTIK_IMAGE_HOST = 'echosell-images.tos-ap-southeast-1.volces.com';
const TEMP_URL_TTL_SECONDS = 72_000; // 20 hours
const BATCH_SIZE = 10;               // products per DB cursor batch
const URL_BATCH_SIZE = 50;           // URLs per EchoTik API call

function cacheKey(url: string): string {
  return `echotik:img:${url}`;
}

function isEchoTikUrl(url: string): boolean {
  return url.includes(ECHOTIK_IMAGE_HOST);
}

async function exchangeAndCache(
  client: EchoTikClient,
  urls: string[]
): Promise<{ resolved: number; failed: number }> {
  const eligible = [...new Set(urls.filter(isEchoTikUrl))];
  if (eligible.length === 0) return { resolved: 0, failed: 0 };

  const tempUrlMap = await client.getTempCoverUrls(eligible);

  let resolved = 0;
  let failed = 0;

  await Promise.all(
    eligible.map(async (url) => {
      const tempUrl = tempUrlMap[url];
      if (tempUrl) {
        await CacheService.set(cacheKey(url), tempUrl, TEMP_URL_TTL_SECONDS);
        resolved++;
      } else {
        failed++;
      }
    })
  );

  return { resolved, failed };
}

async function main(): Promise<void> {
  console.log('Connecting to MongoDB...');
  await connectMongo();

  console.log('Connecting to Redis...');
  const redis = getRedisClient();
  await redis.ping();

  const client = new EchoTikClient();
  const total = await Product.countDocuments({ source: 'echotik', status: { $ne: 'archived' } });
  console.log(`Found ${total} EchoTik products to process.\n`);

  let processed = 0;
  let totalResolved = 0;
  let totalFailed = 0;
  let totalSkipped = 0; // already in cache

  const cursor = Product.find({ source: 'echotik', status: { $ne: 'archived' } })
    .select('imageUrls primaryImageUrl')
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  let urlBatch: string[] = [];

  const flushBatch = async () => {
    if (urlBatch.length === 0) return;

    // Check which are already cached
    const uncached: string[] = [];
    await Promise.all(
      urlBatch.map(async (url) => {
        const hit = await CacheService.get<string>(cacheKey(url));
        if (hit) {
          totalSkipped++;
        } else {
          uncached.push(url);
        }
      })
    );

    if (uncached.length > 0) {
      const { resolved, failed } = await exchangeAndCache(client, uncached);
      totalResolved += resolved;
      totalFailed += failed;
    }

    urlBatch = [];
  };

  for await (const doc of cursor) {
    const urls: string[] = [];
    if (Array.isArray(doc.imageUrls)) urls.push(...(doc.imageUrls as string[]));
    if (doc.primaryImageUrl) urls.push(doc.primaryImageUrl as string);

    urlBatch.push(...urls.filter(isEchoTikUrl));
    processed++;

    if (urlBatch.length >= URL_BATCH_SIZE) {
      await flushBatch();
    }

    if (processed % 50 === 0) {
      console.log(`  Progress: ${processed}/${total} products | resolved=${totalResolved} cached=${totalSkipped} failed=${totalFailed}`);
    }
  }

  // Flush any remaining URLs
  await flushBatch();

  console.log('\n── Done ────────────────────────────────────');
  console.log(`Products processed : ${processed}`);
  console.log(`URLs resolved      : ${totalResolved}`);
  console.log(`URLs already cached: ${totalSkipped}`);
  console.log(`URLs failed        : ${totalFailed}`);
  if (totalFailed > 0) {
    console.log('\nNote: failed URLs are images EchoTik has not yet downloaded (TikTok CDN host).');
    console.log('They will become available 1-3 days after the product was first crawled.');
  }

  await disconnectMongo();
  await redis.quit();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
