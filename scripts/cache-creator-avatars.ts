/**
 * Backfill S3 creator avatars for existing creatives.
 *
 *   npx ts-node --transpile-only scripts/cache-creator-avatars.ts --market US
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { getMarketModels } from '../src/models/market-models.factory';
import { persistCreatorAvatarOnCreative } from '../src/services/creator-avatar-cache.service';
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
  const { Creative } = getMarketModels(market);
  const cursor = Creative.find({ 'creator.handle': { $type: 'string', $regex: /\S/ } })
    .select({ _id: 1 })
    .lean()
    .cursor();

  let n = 0;
  let s3Ok = 0;
  let urlOk = 0;
  let failed = 0;
  for await (const row of cursor) {
    if (limit > 0 && n >= limit) break;
    n += 1;
    try {
      const r = await persistCreatorAvatarOnCreative(String(row._id), Creative, { market });
      if (r?.avatarS3Key) s3Ok += 1;
      else if (r?.avatarUrl) urlOk += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.warn(`  skip ${row._id}:`, String(err));
    }
    if (n % 25 === 0) {
      console.log(`  ${n} processed — S3: ${s3Ok}, URL only: ${urlOk}, failed: ${failed}`);
    }
  }

  console.log(
    `Done (${market}). ${n} processed — ${s3Ok} on S3, ${urlOk} CDN URL only, ${failed} failed.`,
  );
  if (s3Ok === 0 && n > 0) {
    console.log('No S3 uploads — check IAM (see aws-s3-avatar-setup.txt at repo root).');
  }
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
