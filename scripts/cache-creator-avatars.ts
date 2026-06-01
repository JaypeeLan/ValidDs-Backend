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
  let ok = 0;
  for await (const row of cursor) {
    if (limit > 0 && n >= limit) break;
    n += 1;
    const r = await persistCreatorAvatarOnCreative(String(row._id), Creative, { market });
    if (r?.avatarS3Key) ok += 1;
    if (n % 25 === 0) console.log(`  ${n} processed, ${ok} cached to S3`);
  }

  console.log(`Done. ${ok}/${n} avatars cached to S3 for ${market}.`);
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
