import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { Product } from '../src/models/product.model';

type SourceBreakdown = {
  source: string;
  unitsSold: number;
  url?: string;
};

function estimateUnitsFromSignals(product: any): number {
  const comments = Number(product.commentCount || 0);
  const shares = Number(product.shareCount || 0);
  const likes = Number(product.likeCount || 0);
  return Math.max(50, Math.round(comments * 10 + shares * 4 + likes * 0.01));
}

function normalizeBreakdown(product: any): SourceBreakdown[] {
  const existing = Array.isArray(product.salesEvidence?.sourceBreakdown)
    ? product.salesEvidence.sourceBreakdown
    : [];

  const cleaned = existing
    .map((entry: any) => ({
      source: String(entry?.source || '').trim(),
      unitsSold: Math.max(0, Math.round(Number(entry?.unitsSold || 0))),
      url: entry?.url ? String(entry.url) : undefined,
    }))
    .filter((entry: SourceBreakdown) => entry.source && entry.unitsSold > 0);

  if (cleaned.length > 0) return cleaned;

  const directUnits = Math.max(0, Math.round(Number(product.salesEvidence?.unitsSold || 0)));
  if (directUnits > 0) {
    return [{
      source: String(product.salesEvidence?.store || 'Unknown Source'),
      unitsSold: directUnits,
      url: product.salesEvidence?.storeUrl,
    }];
  }

  return [{
    source: 'TikTok Demand Signal (Estimated)',
    unitsSold: estimateUnitsFromSignals(product),
  }];
}

function buildReviews(product: any): Array<{ source: string; text: string; collectedAt: Date }> {
  const existingReviews = Array.isArray(product.reviews) ? product.reviews : [];
  const fromExisting = existingReviews
    .map((r: any) => ({
      source: String(r?.source || '').trim(),
      text: String(r?.text || '').trim(),
      collectedAt: r?.collectedAt ? new Date(r.collectedAt) : new Date(),
    }))
    .filter((r: any) => r.source && r.text);

  const fromTopComments = (Array.isArray(product.topComments) ? product.topComments : [])
    .slice(0, 10)
    .map((c: any) => ({
      source: String(c?.source || 'TikTok').trim(),
      text: String(c?.comment || c?.text || '').trim(),
      collectedAt: c?.collectedAt ? new Date(c.collectedAt) : new Date(),
    }))
    .filter((r: any) => r.text);

  const dedup = new Set<string>();
  const merged = [...fromExisting, ...fromTopComments].filter((r) => {
    const key = `${r.source}|${r.text}`.toLowerCase();
    if (dedup.has(key)) return false;
    dedup.add(key);
    return true;
  });

  const finalReviews = merged.slice(0, 30);
  if (finalReviews.length > 0) return finalReviews;

  const fallbackText =
    String(product?.aiIntelligence?.buyingSentimentReason || '').trim() ||
    String(product?.aiIntelligence?.confidenceReason || '').trim() ||
    String(product?.description || '').trim();

  if (!fallbackText) return [];
  return [{
    source: 'AI Summary',
    text: fallbackText,
    collectedAt: new Date(),
  }];
}

async function main(): Promise<void> {
  console.log('\n🔧 Backfill products: sales breakdown + reviews');
  console.log('====================================================');

  await connectMongo();

  const products: any[] = await Product.find({});
  let updated = 0;

  for (const product of products) {
    const sourceBreakdown = normalizeBreakdown(product);
    const totalUnits = sourceBreakdown.reduce((sum, row) => sum + row.unitsSold, 0);
    const reviews = buildReviews(product);

    const nextSalesEvidence = {
      unitsSold: totalUnits,
      store: String(product.salesEvidence?.store || sourceBreakdown[0]?.source || 'Unknown Source'),
      storeUrl: product.salesEvidence?.storeUrl,
      timeframe: product.salesEvidence?.timeframe,
      sourceBreakdown,
      fetchedAt: product.salesEvidence?.fetchedAt || new Date(),
    };

    const needsSalesUpdate =
      !product.salesEvidence ||
      !Array.isArray(product.salesEvidence.sourceBreakdown) ||
      product.salesEvidence.sourceBreakdown.length === 0 ||
      Number(product.salesEvidence.unitsSold || 0) !== totalUnits;

    const needsReviewsUpdate =
      !Array.isArray(product.reviews) ||
      product.reviews.length !== reviews.length;

    if (!needsSalesUpdate && !needsReviewsUpdate) continue;

    product.salesEvidence = nextSalesEvidence;
    product.reviews = reviews;
    await product.save();
    updated += 1;
  }

  console.log(`Total products scanned: ${products.length}`);
  console.log(`Products updated:       ${updated}`);
  console.log('✅ Backfill complete');

  await disconnectMongo();
}

main().catch(async (err) => {
  console.error('❌ Backfill failed:', err);
  try {
    await disconnectMongo();
  } catch {}
  process.exit(1);
});
