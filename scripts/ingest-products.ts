/**
 * Manual product ingestion script.
 *
 * Runs the EchoTik product ingestion pipeline and then the post-ingest cleanup.
 * This mirrors the scheduled daily job (`runProductIngestionJob`, 00:00
 * Africa/Lagos) but lets operators kick it off on demand.
 *
 * Usage:
 *   npm run ingest-products                           # full run, all regions
 *   npm run ingest-products -- --region=US            # single-region top-up
 *   npm run ingest-products -- --dry-run --limit=2    # preview without writing
 *
 * Flags (optional):
 *   --region=<code>   Run one EchoTik cycle for a single region instead of the
 *                     full multi-region sweep (e.g. US, BR, GB).
 *   --dry-run         Fetch products + run the full enrichment pipeline but
 *                     DO NOT connect to Mongo or write anything. Prints the
 *                     final document that would have been saved.
 *   --limit=<n>       Only process the first N products (dry-run only,
 *                     default 2).
 */

import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { runProductIngestionJob } from '../src/jobs';
import { Product } from '../src/models/product.model';
import { ProductService } from '../src/services/product.service';
import { EchoTikJob } from '../src/ingestion/echotik/echotik.job';
import { EchoTikIngestionPipeline } from '../src/ingestion/echotik/echotik.pipeline';
import { transformEchoTikProducts, transformEchoTikComments } from '../src/ingestion/echotik/echotik.transformer';
import { EchoTikClient } from '../src/ingestion/echotik/echotik.client';
import { ensureCategoriesLoaded } from '../src/ingestion/echotik/echotik.categories';
import { logger } from '../src/logger';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function logDivider(label: string): void {
  console.log(`\n${'─'.repeat(90)}`);
  console.log(label);
  console.log('─'.repeat(90));
}

async function runDryRun(): Promise<void> {
  const region = (parseFlag('region') ?? 'US').toUpperCase();
  const limit  = Math.max(1, Number(parseFlag('limit') || 2));

  console.log('\nValidDs — Product Ingestion DRY RUN');
  console.log('====================================');
  console.log(`Region: ${region}`);
  console.log(`Limit:  ${limit} product(s)`);
  console.log('Mode:   dry-run (no DB writes, no Mongo connection)');
  console.log('');

  const client = new EchoTikClient(region);

  console.log('[1/4] Pinging EchoTik...');
  const alive = await client.ping();
  if (!alive) {
    throw new Error('EchoTik unreachable — check ECHOTIK_USERNAME / ECHOTIK_PASSWORD');
  }
  console.log('      OK');

  console.log('      Loading EchoTik category taxonomy...');
  await ensureCategoriesLoaded().catch((err) => {
    console.log(`      (category load failed: ${String(err)})`);
  });

  console.log(`[2/4] Fetching first page of /product/list (region=${region})...`);
  const rawProducts = await client.listProducts({
    region,
    page_num:               1,
    page_size:              Math.max(limit, 10),
    product_sort_field:     5,
    sort_type:              1,
    min_total_sale_30d_cnt: 50,
  });
  const normalized = transformEchoTikProducts(rawProducts).slice(0, limit);
  console.log(`      Got ${normalized.length} product(s)`);

  if (normalized.length === 0) {
    console.log('No products returned from EchoTik — nothing to preview.');
    return;
  }

  console.log('[3/4] Fetching reviews for products with reviewCount >= 10...');
  const commentsMap = new Map<string, ReturnType<typeof transformEchoTikComments>>();
  for (const p of normalized) {
    if (p.reviewCount >= 10) {
      try {
        const raw = await client.getProductComments(p.productId, region, 1, 10);
        if (raw.length > 0) {
          commentsMap.set(p.productId, transformEchoTikComments(raw, p.productId));
        }
      } catch (err) {
        console.log(`      reviews fetch failed for ${p.productId}: ${String(err)}`);
      }
    }
  }
  console.log(`      Fetched reviews for ${commentsMap.size} product(s)`);

  console.log('[4/4] Building enriched documents (images + SearchApi + EnsembleData)...\n');

  const pipeline = new EchoTikIngestionPipeline();

  for (let i = 0; i < normalized.length; i += 1) {
    const product = normalized[i];
    const comments = commentsMap.get(product.productId) ?? [];

    logDivider(`Product ${i + 1}/${normalized.length} — ${product.productName} (${product.productId})`);

    console.log('\n-- Normalized EchoTik payload --');
    console.log({
      productId:        product.productId,
      productName:      product.productName,
      region:           product.region,
      categoryPath:     product.categoryPath,
      avgPrice:         product.avgPrice,
      rating:           product.rating,
      reviewCount:      product.reviewCount,
      totalSale30dCnt:  product.totalSale30dCnt,
      totalSale7dCnt:   product.totalSale7dCnt,
      totalSaleGmv30dAmt: product.totalSaleGmv30dAmt,
      totalIflCnt:      product.totalIflCnt,
      totalViewsCnt:    product.totalViewsCnt,
      trendScore:       product.trendScore,
      trendDirection:   product.trendDirection,
      isTrending:       product.isTrending,
      isOffMarket:      product.isOffMarket,
      primaryImageUrl:  product.primaryImageUrl,
      imageUrlsCount:   Array.isArray(product.imageUrls) ? product.imageUrls.length : 0,
    });

    console.log(`\n-- EchoTik reviews fetched: ${comments.length} --`);
    if (comments.length > 0) {
      console.log(comments.slice(0, 3).map((c) => ({
        text:      c.text.slice(0, 120),
        sentiment: c.sentiment,
        createdAt: c.createdAt,
      })));
      if (comments.length > 3) console.log(`... (${comments.length - 3} more)`);
    }

    console.log('\n-- Running buildEnrichedInput() (image resolution + SearchApi + EnsembleData) --');
    const input = await pipeline.buildEnrichedInput(product, comments);

    console.log('\n-- FINAL DOCUMENT THAT WOULD BE SAVED --');
    console.dir(input, { depth: null, colors: false, maxArrayLength: 20 });

    console.log('\n-- Key highlights --');
    console.log({
      title:                    input.title,
      primaryImageUrlResolved:  Boolean(input.primaryImageUrl && !input.primaryImageUrl.includes('volces.com')),
      sourcePrimaryImageUrl:    input.sourcePrimaryImageUrl,
      primaryImageUrl:          input.primaryImageUrl,
      imageUrlsCount:           input.imageUrls?.length ?? 0,
      imagesResolvedAt:         input.imagesResolvedAt,
      reviewsCount:             input.reviews?.length ?? 0,
      relatedProductsCount:     input.relatedProducts?.length ?? 0,
      creatorHandle:            input.primaryCreator?.handle,
      creatorTiktokPostUrl:     input.primaryCreator?.tiktokPostUrl,
      viewCount:                input.viewCount,
      likeCount:                input.likeCount,
      trend:                    input.trend,
      salesEvidence:            input.salesEvidence,
    });
  }

  console.log('\n====================================');
  console.log('Dry run complete. Nothing was written to the database.');
}

async function runFullIngestion(): Promise<void> {
  const region   = parseFlag('region');
  const limitStr = parseFlag('limit');
  const maxProducts = limitStr ? Math.max(1, Number(limitStr)) : undefined;
  const clearFirst  = hasFlag('clear');

  console.log('\nValidDs — Manual Product Ingestion');
  console.log('====================================');
  console.log(region ? `Mode: single region (${region})` : 'Mode: full multi-region sweep');
  if (maxProducts) console.log(`Limit: ${maxProducts} product(s)`);
  if (clearFirst)  console.log('Clear:  all active EchoTik products will be deleted before ingest');
  console.log('');

  await connectMongo();
  console.log('Connected to MongoDB.\n');

  if (clearFirst) {
    const { deletedCount } = await Product.deleteMany({ source: 'echotik' });
    console.log(`Deleted ${deletedCount} EchoTik product(s).\n`);
  }

  const startCount = await Product.countDocuments({ status: 'active' });
  console.log(`Active products before run: ${startCount}`);

  if (region || maxProducts) {
    const { EchoTikIngestionPipeline } = await import('../src/ingestion/echotik/echotik.pipeline');
    const pipeline = new EchoTikIngestionPipeline();
    const result = await pipeline.run(
      { region: region?.toUpperCase() },
      maxProducts ? { maxProducts } : {}
    );
    console.log('\nPipeline result:', result);

    const cleanup = await ProductService.cleanupProducts().catch((err) => {
      logger.warn('cleanupProducts failed', { err: String(err) });
      return null;
    });
    console.log('\nSingle-region cycle complete.', { cleanup });
  } else {
    await runProductIngestionJob();
  }

  const endCount = await Product.countDocuments({ status: 'active' });
  console.log(`\nActive products after run: ${endCount} (delta: ${endCount - startCount})`);
}

async function main(): Promise<void> {
  if (hasFlag('dry-run')) {
    await runDryRun();
  } else {
    await runFullIngestion();
  }
}

main()
  .then(async () => {
    if (!hasFlag('dry-run')) await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nIngestion failed:', err);
    logger.error('ingest-products script failed', { err: String(err) });
    if (!hasFlag('dry-run')) await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
