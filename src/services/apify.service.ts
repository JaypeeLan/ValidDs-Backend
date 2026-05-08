import { ApifyClient } from 'apify-client';
import { AppError } from '../middleware/error.middleware';
import { env } from '../config/env.validation';
import { ShopifyScraperItem, TikTokLiveScraperItem } from './apify.types';

const SHOPIFY_ACTOR_ID = 'clearpath/shop-by-shopify-product-scraper';
const TIKTOK_LIVE_ACTOR_ID = 'easyapi/tiktok-live-scraper';

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

export async function runTikTokLiveScraper(keyword: string, maxItems = 20): Promise<TikTokLiveScraperItem[]> {
  if (!env.APIFY_API_TOKEN) {
    throw new AppError(500, 'APIFY_API_TOKEN is not configured', 'APIFY_TOKEN_MISSING');
  }
  if (!keyword.trim()) {
    throw new AppError(400, 'keyword is required', 'VALIDATION_ERROR');
  }

  const normalizedKeyword = keyword.trim().toLowerCase();
  const cappedMax = Math.min(Math.max(1, maxItems), 50);

  const run = await apifyClient.actor(TIKTOK_LIVE_ACTOR_ID).start({
    keywords: [keyword.trim()],
    maxItems: cappedMax,
  });

  const runClient = apifyClient.run(run.id);
  // Live discovery actors are slower than the Shopify actor; give them a longer window.
  const liveTimeoutMs = Math.max(env.APIFY_ACTOR_TIMEOUT_MS, 90_000);
  const timeoutAt = Date.now() + liveTimeoutMs;
  let latestItems: TikTokLiveScraperItem[] = [];

  while (Date.now() < timeoutAt) {
    const currentRun = await runClient.get();
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: cappedMax * 3 });
    const normalized = normalizeTikTokLiveItems(items as unknown[]);
    const keywordMatched = normalized.filter((item) => {
      const hay = `${item.title || ''} ${item.owner?.nickname || ''} ${item.owner?.unique_id || ''}`.toLowerCase();
      return hay.includes(normalizedKeyword);
    });
    latestItems = (keywordMatched.length > 0 ? keywordMatched : normalized).slice(0, cappedMax);

    const status = currentRun?.status;
    const isFinished = status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT';
    if (isFinished) {
      return latestItems;
    }

    await sleep(1500);
  }

  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: cappedMax * 3 });
  const normalized = normalizeTikTokLiveItems(items as unknown[]);
  const keywordMatched = normalized.filter((item) => {
    const hay = `${item.title || ''} ${item.owner?.nickname || ''} ${item.owner?.unique_id || ''}`.toLowerCase();
    return hay.includes(normalizedKeyword);
  });
  let finalItems = (keywordMatched.length > 0 ? keywordMatched : normalized).slice(0, cappedMax);

  // If the actor is still finishing and we got nothing yet, wait a bit longer once.
  if (finalItems.length === 0) {
    try {
      await runClient.waitForFinish({ waitSecs: 45 });
      const retry = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: cappedMax * 3 });
      const retryNorm = normalizeTikTokLiveItems(retry.items as unknown[]);
      const retryMatched = retryNorm.filter((item) => {
        const hay = `${item.title || ''} ${item.owner?.nickname || ''} ${item.owner?.unique_id || ''}`.toLowerCase();
        return hay.includes(normalizedKeyword);
      });
      finalItems = (retryMatched.length > 0 ? retryMatched : retryNorm).slice(0, cappedMax);
    } catch {
      // Keep original empty payload if second wait fails/times out.
    }
  }

  // For live discovery we prefer a partial/empty response over hard failure.
  // Actor runs can take longer than the per-request timeout.
  return finalItems;
}

function normalizeTikTokLiveItems(rawItems: unknown[]): TikTokLiveScraperItem[] {
  return rawItems
    .map((raw) => {
      const item = raw as any;

      // easyapi shape (kept for compatibility)
      if (item?.stream_url || item?.owner || item?.id_str) {
        return item as TikTokLiveScraperItem;
      }

      // coregent shape
      const creatorUsername = item?.creatorUsername || '';
      const roomUrl = item?.roomUrl || (creatorUsername ? `https://www.tiktok.com/@${creatorUsername}/live` : '');
      const streamUrl = item?.streamUrl || item?.stream_url || '';

      return {
        id: item?.roomId || item?.id || '',
        id_str: String(item?.roomId || item?.id || ''),
        title: item?.liveTitle || item?.roomDescription || '',
        user_count: item?.viewerCount ?? null,
        cover: { url_list: item?.coverImageUrl ? [item.coverImageUrl] : [] },
        stats: { total_user: item?.viewerCount ?? null },
        owner: {
          id: item?.creatorId || '',
          nickname: item?.creatorDisplayName || creatorUsername || '',
          unique_id: creatorUsername || '',
          follow_info: { follower_count: item?.creatorFollowersCount ?? null },
        },
        stream_url: {
          rtmp_pull_url: streamUrl || roomUrl || '',
          flv_pull_url: streamUrl ? { HD1: streamUrl } : undefined,
        },
        create_time: item?.startTime ? Math.floor(new Date(item.startTime).getTime() / 1000) : undefined,
      } as TikTokLiveScraperItem;
    })
    .filter((x) => Boolean(x?.id_str || x?.id));
}
