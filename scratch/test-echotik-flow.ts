/**
 * End-to-end flow test using an existing EchoTik product from the DB.
 * Tests: image URL resolution, SearchApi reviews, and the final persisted document.
 * Run: npx ts-node scratch/test-echotik-flow.ts
 */
import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { getRedisClient } from '../src/cache/redis.client';
import { SearchApiService } from '../src/services/search.service';
import { resolveEchoTikImageUrls } from '../src/ingestion/echotik/echotik.image';
import { Product } from '../src/models/product.model';

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function json(label: string, data: unknown) {
  console.log(`\n── ${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  console.log('\nConnecting...');
  await connectMongo();
  const redis = getRedisClient();
  await redis.ping();
  console.log('MongoDB + Redis connected');

  // ── Step 1: Load existing EchoTik product from DB ────────────────────────
  section('Step 1 — Load existing EchoTik product from DB');
  const doc = await Product.findOne({ source: 'echotik' }).lean();
  if (!doc) {
    console.error('No EchoTik products found in DB');
    process.exit(1);
  }

  json('Product loaded', {
    _id:          doc._id,
    title:        doc.title,
    region:       (doc as any).region,
    imageUrls:    doc.imageUrls,
    primaryImageUrl: doc.primaryImageUrl,
    reviews:      doc.reviews,
    relatedProducts: doc.relatedProducts,
    discoverySections: doc.discoverySections,
  });

  // ── Step 2: Resolve image URLs ────────────────────────────────────────────
  section('Step 2 — Resolve EchoTik image URLs');
  const allUrls = (doc.imageUrls ?? []).filter(Boolean);
  console.log(`\nURLs to resolve: ${allUrls.length}`);

  const urlMap = await resolveEchoTikImageUrls(allUrls);
  json('URL map (original → temp)', urlMap);

  const resolvedUrls = allUrls.map(u => urlMap[u] ?? `[unresolved] ${u}`);
  json('Resolved URLs', resolvedUrls);

  // ── Step 3: SearchApi review fetch ────────────────────────────────────────
  section('Step 3 — SearchApi: google_shopping → google_product');
  console.log(`\nSearching for: "${doc.title}"`);

  const { reviews, relatedProducts, offers } =
    await SearchApiService.fetchProductReviews(doc.title);

  json('Reviews', reviews);
  json('Related products', relatedProducts);
  json('Offers', offers);

  // ── Step 4: Persist updates to DB ─────────────────────────────────────────
  section('Step 4 — Persist updates to DB');

  const update: Record<string, any> = {};

  if (reviews.length > 0) {
    update.reviews = reviews.map(r => ({
      source:      r.source,
      text:        r.text,
      collectedAt: new Date(),
    }));
    console.log(`\nStoring ${reviews.length} reviews`);
  } else {
    console.log('\nNo reviews found — reviews field unchanged');
  }

  if (relatedProducts.length > 0) {
    update.relatedProducts = relatedProducts;
    console.log(`Storing ${relatedProducts.length} related products`);
  }

  if (Object.keys(update).length > 0) {
    await Product.updateOne({ _id: doc._id }, { $set: update });
    console.log('DB updated');
  }

  // ── Step 5: Read final document ───────────────────────────────────────────
  section('Step 5 — Final document from MongoDB');
  const final = await Product.findById(doc._id).lean();
  console.log(JSON.stringify(final, null, 2));

  await disconnectMongo();
  await redis.quit();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
