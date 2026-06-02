/**
 * Refresh missing creative media fields (videoPlayUrl / thumbnails / avatars) by
 * calling CreativeService.refreshCreativeMedia for each creative slot.
 *
 * Usage:
 *   cd validDs-backend
 *   npm run -s ts-node -- scripts/maintenance/refresh-creatives-media.ts --market US
 *   npm run -s ts-node -- scripts/maintenance/refresh-creatives-media.ts --market US --limit 50
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { getMarketModels } from '../../src/models/market-models.factory';
import { CreativeService } from '../../src/services/creative.service';
import { toMarketCode } from '../../src/utils/markets';

function argVal(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const market = toMarketCode((argVal('--market') || 'US').toUpperCase());
  const limitRaw = argVal('--limit');
  const limit = limitRaw ? Math.max(1, Math.floor(Number(limitRaw))) : 10_000;
  const allSlots = hasFlag('--all-slots');

  const uri = process.env.MONGODB_URI || '';
  if (!uri) throw new Error('MONGODB_URI missing');

  const dbName = (process.env.MONGODB_DB || process.env.MONGODB_DATABASE || 'validds').trim();
  await mongoose.connect(uri, { dbName });

  const { Creative } = getMarketModels(market);

  const filter = {
    $and: [
      { $or: [{ videoS3Key: { $exists: false } }, { videoS3Key: null }, { videoS3Key: '' }] },
      { $or: [{ videoPlayUrl: { $exists: false } }, { videoPlayUrl: null }, { videoPlayUrl: '' }] },
    ],
  };

  const ids = await Creative.find(filter, { _id: 1 })
    .limit(limit)
    .lean()
    .then((rows) => rows.map((r) => String((r as { _id: unknown })._id)));

  let refreshed = 0;
  let scanned = 0;
  for (const id of ids) {
    scanned += 1;
    const ok = allSlots
      ? await CreativeService.refreshAllSlotsForCreative(id).then((r) => r.refreshed > 0)
      : await CreativeService.refreshCreativeMedia(id, 0, market, Creative);
    if (ok) refreshed += 1;
    if (scanned % 25 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[${market}] scanned ${scanned}/${ids.length} refreshed=${refreshed}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ market, scanned, refreshed, ids: ids.length }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
