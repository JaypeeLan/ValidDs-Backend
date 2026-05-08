import { ApifyClient } from 'apify-client';
import { AppError } from '../middleware/error.middleware';
import { env } from '../config/env.validation';
import { ShopifyScraperItem } from './apify.types';

const SHOPIFY_ACTOR_ID = 'clearpath/shop-by-shopify-product-scraper';

const apifyClient = new ApifyClient({
  token: env.APIFY_API_TOKEN,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runShopifyScraper(keyword: string): Promise<ShopifyScraperItem[]> {
  if (!env.APIFY_API_TOKEN) {
    throw new AppError(500, 'APIFY_API_TOKEN is not configured', 'APIFY_TOKEN_MISSING');
  }

  const run = await apifyClient.actor(SHOPIFY_ACTOR_ID).start({
    query: keyword,
    maxItems: env.APIFY_SHOPIFY_MAX_ITEMS,
  });

  const runClient = apifyClient.run(run.id);
  const timeoutAt = Date.now() + env.APIFY_ACTOR_TIMEOUT_MS;
  let latestItems: ShopifyScraperItem[] = [];

  while (Date.now() < timeoutAt) {
    const currentRun = await runClient.get();
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    latestItems = items as unknown as ShopifyScraperItem[];

    const status = currentRun?.status;
    const isFinished = status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT';
    if (isFinished) {
      return latestItems;
    }

    await sleep(1500);
  }

  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
  const finalItems = items as unknown as ShopifyScraperItem[];

  if (finalItems.length > 0) {
    return finalItems;
  }

  throw new AppError(504, `Shopify actor timed out after ${env.APIFY_ACTOR_TIMEOUT_MS}ms`, 'APIFY_TIMEOUT');
}
