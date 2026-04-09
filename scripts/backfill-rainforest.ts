import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../src/db/client';
import { Product } from '../src/models/product.model';
import { RainforestService } from '../src/services/rainforest.service';
import { RainforestProduct } from '../src/services/rainforest.types';
import { logger } from '../src/logger';

const log = logger.child({ module: 'backfill-rainforest' });

function computePriceStats(results: RainforestProduct[]): {
  avgPrice: number;
  minPrice: number | undefined;
  maxPrice: number | undefined;
} {
  const prices = results
    .map(r => r.price?.value ?? r.prices?.[0]?.value)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  if (prices.length === 0) {
    return { avgPrice: 0, minPrice: undefined, maxPrice: undefined };
  }

  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;

  return {
    avgPrice: Math.round(avg * 100) / 100,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
  };
}

function pickBestTitle(results: RainforestProduct[], fallback: string): string {
  const titles = results
    .slice(0, 5)
    .map(r => r.title?.trim())
    .filter((t): t is string => Boolean(t));

  const short = titles.find(t => t.length <= 80);
  if (short) return short;

  if (titles[0]) return titles[0].slice(0, 80).trim();

  return fallback.slice(0, 80).trim();
}

function collectImages(
  results: RainforestProduct[],
  tiktokThumbnail?: string
): { primaryImageUrl: string | undefined; imageUrls: string[] } {
  const allImages = results
    .map(r => r.image)
    .filter((img): img is string => Boolean(img));

  const uniqueImages = [...new Set(allImages)].slice(0, 10);

  if (uniqueImages.length > 0) {
    return { primaryImageUrl: uniqueImages[0], imageUrls: uniqueImages };
  }

  if (tiktokThumbnail) {
    return { primaryImageUrl: tiktokThumbnail, imageUrls: [tiktokThumbnail] };
  }

  return { primaryImageUrl: undefined, imageUrls: [] };
}

async function run() {
  log.info('Starting Rainforest backfill script...');

  if (!process.env.RAINFOREST_API_KEY) {
    log.error('RAINFOREST_API_KEY is missing from .env');
    process.exit(1);
  }

  await connectMongo();

  const products = await Product.find({ status: 'active' });
  log.info(`Found ${products.length} products to process`);

  let count = 0;
  for (const product of products) {
    count++;
    log.info(`Processing product ${count}/${products.length}: ${product.title}`);

    try {
      // Use the actual search term we stored, or fallback to the title
      const searchTerm = product.title;
      const response = await RainforestService.searchAmazonProducts(searchTerm);
      const searchResults = response?.search_results;

      if (!searchResults || searchResults.length === 0) {
        log.warn(`No Rainforest results for: ${searchTerm}`);
        continue;
      }

      const { avgPrice, minPrice, maxPrice } = computePriceStats(searchResults);
      const title = pickBestTitle(searchResults, product.title);
      const { primaryImageUrl, imageUrls } = collectImages(searchResults, product.primaryImageUrl);

      product.price = avgPrice;
      product.priceMin = minPrice;
      product.priceMax = maxPrice;
      product.title = title;
      product.primaryImageUrl = primaryImageUrl;
      
      // Merge unique images
      const mergedImages = new Set([...imageUrls, ...product.imageUrls]);
      product.imageUrls = Array.from(mergedImages).slice(0, 10);

      await product.save();
      log.info(`Updated product: ${product.externalId} with avg price $${avgPrice}`);

      // Small delay to avoid API rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      log.error(`Failed to process product ${product.externalId}`, err);
    }
  }

  log.info('Backfill complete!');
  await disconnectMongo();
}

run().catch((err) => {
  log.fatal('Script crashed', err);
  process.exit(1);
});
