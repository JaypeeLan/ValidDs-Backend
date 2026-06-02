/**
 * Repair wrong shop logos (creator profile avatars cached as shop logos).
 *
 *   npx ts-node --transpile-only scripts/repair-shop-avatars.ts --market US
 *   npx ts-node --transpile-only scripts/repair-shop-avatars.ts --market US --shop Crocs
 *   npx ts-node --transpile-only scripts/repair-shop-avatars.ts --market US --scan-only
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { getMarketModels } from '../src/models/market-models.factory';
import { persistShopAvatarOnProduct } from '../src/services/creator-avatar-cache.service';
import { fetchFreshShopLogoUrls } from '../src/services/scrapecreators-shop.service';
import { toMarketCode } from '../src/utils/markets';
import { isSuspiciousShopAvatarUrl, shopAvatarUrlBase } from '../src/utils/shop-avatar.util';

type ShopRow = {
  _id: unknown;
  shopName: string;
  shopUrl?: string;
  shopAvatarUrl?: string;
  primaryImageUrl?: string;
  primaryCreator?: { avatarUrl?: string; primaryImageUrl?: string };
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const market = toMarketCode(
    String(
      args.find((a) => a.startsWith('--market='))?.split('=')[1] ??
        (args.includes('--market') ? args[args.indexOf('--market') + 1] : 'US'),
    ).toUpperCase(),
  );
  const shopFilter = args
    .find((a) => a.startsWith('--shop='))
    ?.split('=')[1]
    ?.trim();
  const scanOnly = args.includes('--scan-only');
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0) || 0;

  await connectMongo();
  const { Product, Creative } = getMarketModels(market);

  const query: Record<string, unknown> = {
    shopName: { $type: 'string', $regex: /\S/ },
    shopUrl: { $type: 'string', $regex: /^https:\/\// },
  };
  if (shopFilter) {
    query.shopName = {
      $regex: new RegExp(`^${shopFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    };
  }

  const cursor = Product.find(query)
    .select({
      shopName: 1,
      shopUrl: 1,
      shopAvatarUrl: 1,
      primaryImageUrl: 1,
      'primaryCreator.avatarUrl': 1,
      'primaryCreator.primaryImageUrl': 1,
    })
    .lean()
    .cursor();

  const seen = new Set<string>();
  let scanned = 0;
  let suspicious = 0;
  let repaired = 0;
  let failed = 0;

  for await (const row of cursor) {
    const doc = row as ShopRow;
    const shopName = String(doc.shopName ?? '').trim();
    const dedupeKey = `${market}:${shopName.toLowerCase()}`;
    if (!shopName || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (limit > 0 && scanned >= limit) break;
    scanned += 1;

    const creatorAvatar = doc.primaryCreator?.avatarUrl ?? doc.primaryCreator?.primaryImageUrl;
    const suspicion = isSuspiciousShopAvatarUrl({
      shopAvatarUrl: doc.shopAvatarUrl,
      creatorAvatarUrl: creatorAvatar,
      primaryImageUrl: doc.primaryImageUrl,
    });

    const fresh = await fetchFreshShopLogoUrls({
      shopName,
      shopUrl: doc.shopUrl,
      region: market,
    });
    const catalogLogo = fresh[0];
    const currentBase = doc.shopAvatarUrl ? shopAvatarUrlBase(doc.shopAvatarUrl) : '';
    const catalogBase = catalogLogo ? shopAvatarUrlBase(catalogLogo) : '';
    const mismatched = Boolean(
      catalogLogo && currentBase && catalogBase && currentBase !== catalogBase,
    );

    if (!suspicion && !mismatched) continue;
    suspicious += 1;

    console.log(
      `[suspicious] ${shopName} product=${String(doc._id)} mismatched=${mismatched} catalog=${catalogLogo?.slice(0, 72) ?? 'none'}`,
    );

    if (scanOnly) continue;

    try {
      const result = await persistShopAvatarOnProduct(String(doc._id), Product, Creative, {
        market,
        forceRefresh: true,
      });
      if (result?.shopAvatarS3Key || result?.shopAvatarUrl) {
        repaired += 1;
        console.log(`  -> repaired ${shopName} s3=${result.shopAvatarS3Key ?? 'n/a'}`);
      } else {
        failed += 1;
        console.log(`  -> failed ${shopName} (no catalog logo cached)`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`  -> error ${shopName}:`, String(err));
    }
  }

  console.log(
    `Done (${market}). scanned=${scanned} unique shops, suspicious=${suspicious}, repaired=${repaired}, failed=${failed}${scanOnly ? ' (scan-only)' : ''}`,
  );
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
