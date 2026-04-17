/**
 * Recompute discoverySections with current DiscoveryService rules, then tag
 * additional products as top-ads using a catalog-relative view cutoff (top ~25%
 * of non-archived products, with a minimum view floor) so smaller catalogs still
 * get a meaningful slice of isTopAd / top-ads without everything being true.
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { Product } from '../src/models/product.model';
import { DiscoveryService } from '../src/services/discovery.service';

/** Tag roughly the top this fraction of the catalog (by views) as top-ads when other signals are weak. */
const TOP_AD_PERCENTILE = 0.25;

function viewCutoffForTopAds(viewCounts: number[]): number | null {
  const positive = viewCounts.filter((v) => v > 0);
  if (positive.length === 0) return null;
  const sorted = [...positive].sort((a, b) => b - a);
  const take = Math.max(1, Math.ceil(sorted.length * TOP_AD_PERCENTILE));
  return sorted[take - 1] ?? null;
}

async function main(): Promise<void> {
  await connectMongo();

  const products = await Product.find({ status: { $ne: 'archived' } });
  const cutoff = viewCutoffForTopAds(products.map((p) => p.viewCount || 0));

  let updated = 0;
  for (const doc of products) {
    const sections = new Set(await DiscoveryService.categorizeProduct(doc, null));
    if (cutoff != null && (doc.viewCount || 0) >= cutoff) {
      sections.add('top-ads');
    }
    const next = [...sections];
    const prev = [...(doc.discoverySections || [])].sort().join('|');
    const nxt = [...next].sort().join('|');
    if (prev !== nxt) {
      doc.discoverySections = next;
      await doc.save();
      updated++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ total: products.length, viewCutoff: cutoff, updated }, null, 2));
  await disconnectMongo();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
