import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { Product } from '../src/models/product.model';
import { Creative } from '../src/models/creative.model';
import { HashtagIngestionPipeline } from '../src/ingestion/ensemble/hashtag-ingestion.pipeline';
import { CreativeService } from '../src/services/creative.service';
import { EnsembleClient } from '../src/ingestion/ensemble/ensemble.client';
import { SerpService } from '../src/services/serp.service';
import { TeemDropService } from '../src/services/teemdrop.service';
import { AIOrchestrator } from '../src/services/ai.orchestrator';

type ServiceName = 'mongo' | 'ensemble' | 'serp' | 'teemdrop' | 'ai';

type ServiceStatus = Record<ServiceName, boolean>;

const PRODUCT_TARGET = Number(process.argv[2] || 600);
const CREATIVE_TARGET = Number(process.argv[3] || 600);
const MAX_PRODUCT_CYCLES = Number(process.argv[4] || 250);
const MAX_CREATIVE_CYCLES = Number(process.argv[5] || 250);
const PRODUCT_BATCH_SIZE = 25;

async function getCreativeVideoTotal(): Promise<number> {
  const rows = await Creative.aggregate([
    {
      $project: {
        videoCount: {
          $add: [
            1,
            { $size: { $ifNull: ['$relatedVideos', []] } },
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$videoCount' },
      },
    },
  ]);

  return rows[0]?.total || 0;
}

async function runPreflightChecks(): Promise<ServiceStatus> {
  const status: ServiceStatus = {
    mongo: false,
    ensemble: false,
    serp: false,
    teemdrop: false,
    ai: false,
  };

  try {
    await connectMongo();
    status.mongo = true;
  } catch {
    status.mongo = false;
  }

  try {
    status.ensemble = await new EnsembleClient('US').ping();
  } catch {
    status.ensemble = false;
  }

  try {
    status.serp = !!(await SerpService.getRichProductData('portable blender'));
  } catch {
    status.serp = false;
  }

  try {
    status.teemdrop = !!(await TeemDropService.listProducts(1, 1));
  } catch {
    status.teemdrop = false;
  }

  try {
    const ai = await AIOrchestrator.extractJson<{ ok: boolean }>(
      'Return strict JSON: {"ok": true}',
      'ping',
      'gemini'
    );
    status.ai = !!ai;
  } catch {
    status.ai = false;
  }

  return status;
}

function assertServicesReady(status: ServiceStatus): void {
  const failed = Object.entries(status)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  console.log('\n🔎 Service preflight status');
  for (const [name, ok] of Object.entries(status)) {
    console.log(`- ${name}: ${ok ? 'OK' : 'FAIL'}`);
  }

  if (failed.length > 0) {
    throw new Error(
      `Preflight failed. Fix these services before ingestion: ${failed.join(', ')}`
    );
  }
}

async function ingestProductsToTarget(target: number): Promise<void> {
  const pipeline = new HashtagIngestionPipeline();
  let cycles = 0;

  while (cycles < MAX_PRODUCT_CYCLES) {
    const currentProducts = await Product.countDocuments({ status: 'active' });
    if (currentProducts >= target) {
      console.log(`\n✅ Product target reached: ${currentProducts}/${target}`);
      return;
    }

    console.log(`\n[Products] cycle ${cycles + 1} | current=${currentProducts} target=${target}`);
    await pipeline.run();
    cycles += 1;
  }

  const finalCount = await Product.countDocuments({ status: 'active' });
  throw new Error(
    `Product target not reached after ${MAX_PRODUCT_CYCLES} cycles. Final count=${finalCount}, target=${target}`
  );
}

async function ingestCreativesToTarget(target: number): Promise<void> {
  let cycles = 0;
  let stagnantRounds = 0;
  let previousTotal = await getCreativeVideoTotal();

  while (cycles < MAX_CREATIVE_CYCLES) {
    const currentTotal = await getCreativeVideoTotal();
    if (currentTotal >= target) {
      console.log(`\n✅ Creative target reached: ${currentTotal}/${target}`);
      return;
    }

    console.log(`\n[Creatives] cycle ${cycles + 1} | current=${currentTotal} target=${target}`);

    const products: any[] = await Product.find({ status: 'active' })
      .sort({ lastIngestedAt: 1, createdAt: 1 })
      .limit(PRODUCT_BATCH_SIZE);

    if (products.length === 0) {
      throw new Error('No active products found to ingest creatives for.');
    }

    for (const product of products) {
      await CreativeService.fetchAndIngestCreatives(product.title, product._id, {
        brand: product.aiIntelligence?.brand,
        categoryKeywords: product.aiIntelligence?.categoryKeywords || [],
        categoryL1: product.categoryL1,
        categoryL2: product.categoryL2,
        categoryL3: product.categoryL3,
        productDescription: product.description,
      });
    }

    const after = await getCreativeVideoTotal();
    if (after <= previousTotal) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }
    previousTotal = after;

    if (stagnantRounds >= 5) {
      throw new Error(
        `Creative ingestion stalled for ${stagnantRounds} consecutive rounds. Current total=${after}`
      );
    }

    cycles += 1;
  }

  const finalTotal = await getCreativeVideoTotal();
  throw new Error(
    `Creative target not reached after ${MAX_CREATIVE_CYCLES} cycles. Final total=${finalTotal}, target=${target}`
  );
}

async function main(): Promise<void> {
  console.log('\n🚀 ValidDs — Ingest Products + Creatives');
  console.log(`Targets: products=${PRODUCT_TARGET}, creatives=${CREATIVE_TARGET}`);
  console.log('====================================================');

  try {
    const status = await runPreflightChecks();
    assertServicesReady(status);

    await ingestProductsToTarget(PRODUCT_TARGET);
    await ingestCreativesToTarget(CREATIVE_TARGET);

    const [products, creativesDocs, creativeVideos] = await Promise.all([
      Product.countDocuments({ status: 'active' }),
      Creative.countDocuments({}),
      getCreativeVideoTotal(),
    ]);

    console.log('\n====================================================');
    console.log('✅ INGESTION COMPLETE');
    console.log(`Products (active): ${products}`);
    console.log(`Creative docs:     ${creativesDocs}`);
    console.log(`Creative videos:   ${creativeVideos}`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((err) => {
  console.error('\n❌ Ingestion failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
