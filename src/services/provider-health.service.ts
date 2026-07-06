import { env } from '../config/env.validation';
import { getRedisClient } from '../cache/redis.client';
import mongoose from 'mongoose';

export type ProviderStatus = 'ok' | 'warn' | 'fail' | 'skip' | 'not_configured';

export interface ProviderHealthCheck {
  id: string;
  name: string;
  category: 'ai' | 'data' | 'storage' | 'infrastructure' | 'payments';
  status: ProviderStatus;
  configured: boolean;
  detail: string;
  httpStatus?: number;
  checkedAt: string;
}

interface CacheEntry {
  checkedAt: string;
  checks: ProviderHealthCheck[];
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function probe(
  id: string,
  name: string,
  category: ProviderHealthCheck['category'],
  configured: boolean,
  run: () => Promise<{ status: ProviderStatus; detail: string; httpStatus?: number }>,
): Promise<ProviderHealthCheck> {
  const checkedAt = new Date().toISOString();
  if (!configured) {
    return {
      id,
      name,
      category,
      status: 'not_configured',
      configured: false,
      detail: 'API key not set',
      checkedAt,
    };
  }
  try {
    const result = await run();
    return { id, name, category, configured: true, checkedAt, ...result };
  } catch (err) {
    return {
      id,
      name,
      category,
      status: 'fail',
      configured: true,
      detail: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

async function checkDeepSeek(): Promise<ProviderHealthCheck> {
  return probe('deepseek', 'DeepSeek', 'ai', !!env.DEEPSEEK_API_KEY, async () => {
    const res = await fetch('https://api.deepseek.com/v1/models', {
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 200)
      return { status: 'ok', detail: 'API key valid', httpStatus: res.status };
    if (res.status === 401)
      return { status: 'fail', detail: 'Key rejected (401)', httpStatus: res.status };
    if (res.status === 402)
      return {
        status: 'fail',
        detail: 'Insufficient balance — top up required',
        httpStatus: res.status,
      };
    if (res.status === 429)
      return { status: 'warn', detail: 'Rate limited (429)', httpStatus: res.status };
    const body = await res.text().catch(() => '');
    return {
      status: 'fail',
      detail: `HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
      httpStatus: res.status,
    };
  });
}

async function checkGoogleAI(): Promise<ProviderHealthCheck> {
  const key = env.GOOGLE_AI_API_KEY ?? env.GOOGLE_API_KEY;
  return probe('google-ai', 'Google AI (Gemini)', 'ai', !!key, async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key!)}`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (res.status === 200)
      return { status: 'ok', detail: 'API key valid', httpStatus: res.status };
    if (res.status === 403)
      return {
        status: 'fail',
        detail: 'Key rejected or quota exceeded (403)',
        httpStatus: res.status,
      };
    if (res.status === 429)
      return { status: 'warn', detail: 'Rate limited (429)', httpStatus: res.status };
    return { status: 'fail', detail: `HTTP ${res.status}`, httpStatus: res.status };
  });
}

async function checkScrapeCreators(): Promise<ProviderHealthCheck> {
  return probe(
    'scrapecreators',
    'ScrapeCreators',
    'data',
    !!env.SCRAPECREATORS_API_KEY,
    async () => {
      const base = (env.SCRAPECREATORS_BASE_URL ?? 'https://api.scrapecreators.com').replace(
        /\/$/,
        '',
      );
      const res = await fetch(`${base}/v1/tiktok/profile?handle=tiktok`, {
        headers: { 'X-API-KEY': env.SCRAPECREATORS_API_KEY! },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401)
        return { status: 'fail', detail: 'Key rejected (401)', httpStatus: res.status };
      if (res.status === 402)
        return {
          status: 'fail',
          detail: 'Credits exhausted — payment required',
          httpStatus: res.status,
        };
      if (res.status === 429)
        return { status: 'warn', detail: 'Rate limited (429)', httpStatus: res.status };
      if ([200, 400, 404, 422].includes(res.status)) {
        return {
          status: 'ok',
          detail: `Key accepted (HTTP ${res.status})`,
          httpStatus: res.status,
        };
      }
      return { status: 'fail', detail: `Unexpected HTTP ${res.status}`, httpStatus: res.status };
    },
  );
}

const APIFY_SHOPIFY_STORE_LEADS_ACTOR = 'clearpath~shopify-store-leads';

function apifyAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function checkApify(): Promise<ProviderHealthCheck> {
  return probe('apify', 'Apify (Shopify store leads)', 'data', !!env.APIFY_API_TOKEN, async () => {
    const token = env.APIFY_API_TOKEN!;
    const headers = apifyAuthHeaders(token);

    // /users/me needs account-admin scope; probe the Shopify actor we actually run.
    const res = await fetch(`https://api.apify.com/v2/acts/${APIFY_SHOPIFY_STORE_LEADS_ACTOR}`, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 200) {
      const data = (await res.json().catch(() => ({}))) as {
        data?: { name?: string; username?: string };
      };
      const name = data.data?.name ?? 'shopify-store-leads';
      const user = data.data?.username ?? 'clearpath';
      return {
        status: 'ok',
        detail: `Token valid (${user}/${name})`,
        httpStatus: res.status,
      };
    }
    if (res.status === 401) {
      return { status: 'fail', detail: 'Token rejected (401)', httpStatus: res.status };
    }
    if (res.status === 403) {
      return {
        status: 'fail',
        detail:
          'Token rejected (403) — regenerate in Apify Console with access to clearpath/shopify-store-leads',
        httpStatus: res.status,
      };
    }
    if (res.status === 404) {
      return {
        status: 'fail',
        detail: 'Shopify store-leads actor not found (404)',
        httpStatus: res.status,
      };
    }
    return { status: 'fail', detail: `HTTP ${res.status}`, httpStatus: res.status };
  });
}

async function checkMongo(): Promise<ProviderHealthCheck> {
  return probe('mongodb', 'MongoDB', 'infrastructure', true, async () => {
    const state = mongoose.connection.readyState;
    if (state !== 1) {
      return { status: 'fail', detail: `Not connected (${mongoose.STATES[state] ?? state})` };
    }
    await mongoose.connection.db!.admin().ping();
    return {
      status: 'ok',
      detail: `Connected (${env.MONGODB_URI?.includes('localhost') ? 'local' : 'remote'})`,
    };
  });
}

async function checkRedis(): Promise<ProviderHealthCheck> {
  return probe('redis', 'Redis', 'infrastructure', true, async () => {
    const start = Date.now();
    await getRedisClient().ping();
    const ms = Date.now() - start;
    return { status: 'ok', detail: `Connected (${ms}ms latency)` };
  });
}

export async function runProviderHealthChecks(force = false): Promise<{
  checkedAt: string;
  providers: ProviderHealthCheck[];
}> {
  const now = Date.now();
  if (!force && cache && now - new Date(cache.checkedAt).getTime() < CACHE_TTL_MS) {
    return { checkedAt: cache.checkedAt, providers: cache.checks };
  }

  const checks = await Promise.all([
    checkMongo(),
    checkRedis(),
    checkDeepSeek(),
    checkGoogleAI(),
    checkScrapeCreators(),
    checkApify(),
  ]);

  const checkedAt = new Date().toISOString();
  cache = { checkedAt, checks };
  return { checkedAt, providers: checks };
}

export function providerSummary(providers: ProviderHealthCheck[]): {
  ok: number;
  warn: number;
  fail: number;
  notConfigured: number;
} {
  return providers.reduce(
    (acc, p) => {
      if (p.status === 'ok') acc.ok += 1;
      else if (p.status === 'warn') acc.warn += 1;
      else if (p.status === 'fail') acc.fail += 1;
      else if (p.status === 'not_configured') acc.notConfigured += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0, notConfigured: 0 },
  );
}
