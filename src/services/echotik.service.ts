import { env } from '../config/env.validation';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../logger';
import { EchoTikApiResponse, EchoTikInfluencer, EchoTikLiveStream } from './echotik.types';

const log = logger.child({ module: 'echotik-service' });

const INFLUENCER_LIST_PATHS = [
  '/api/v3/echotik/influencer/list',
  '/api/v3/influencer/list',
  '/echotik/influencer/list',
];
const INFLUENCER_LIVE_LIST_PATHS = [
  '/api/v3/echotik/influencer/live/list',
  '/api/v3/influencer/live/list',
  '/echotik/influencer/live/list',
];

function getAuthHeader(): string | null {
  if (!env.ECHOTIK_USERNAME || !env.ECHOTIK_PASSWORD) {
    return null;
  }
  return `Basic ${Buffer.from(`${env.ECHOTIK_USERNAME}:${env.ECHOTIK_PASSWORD}`, 'utf8').toString('base64')}`;
}

function parseEchoTikPayload<T>(text: string): EchoTikApiResponse<T> | null {
  try {
    return JSON.parse(text) as EchoTikApiResponse<T>;
  } catch {
    return null;
  }
}

async function echotikGet<T>(paths: string[], query: Record<string, string | number>): Promise<T> {
  const auth = getAuthHeader();
  if (!auth) {
    throw new AppError(500, 'EchoTik credentials are not configured', 'ECHOTIK_CREDENTIALS_MISSING');
  }
  let lastErrorMessage = '';

  for (const path of paths) {
    const url = new URL(path, env.ECHOTIK_BASE_URL);
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: auth,
      },
    });

    const text = await res.text();
    const parsed = parseEchoTikPayload<T>(text);
    const upstreamMessage = parsed?.message || (parsed as any)?.msg || undefined;
    const contentType = res.headers.get('content-type') || '';

    if (!res.ok) {
      log.warn('EchoTik request failed', {
        path,
        status: res.status,
        message: upstreamMessage,
        code: parsed?.code,
      });

      // EchoTik can expose the API on different route prefixes depending on environment.
      // Keep trying on 404 until all known path variants are exhausted.
      if (res.status === 404) {
        lastErrorMessage = upstreamMessage || `EchoTik request failed (${res.status})`;
        continue;
      }

      throw new AppError(502, upstreamMessage || `EchoTik request failed (${res.status})`, 'ECHOTIK_REQUEST_FAILED');
    }

    if (!contentType.includes('application/json')) {
      lastErrorMessage = 'EchoTik endpoint returned non-JSON content';
      continue;
    }

    if (!parsed) {
      lastErrorMessage = 'EchoTik returned invalid JSON';
      continue;
    }

    if (typeof parsed.code === 'number' && parsed.code !== 0) {
      throw new AppError(502, upstreamMessage || 'EchoTik returned an error', 'ECHOTIK_API_ERROR');
    }

    return parsed.data;
  }

  throw new AppError(
    502,
    `${lastErrorMessage || 'EchoTik endpoint not found'}. Verify ECHOTIK_BASE_URL from your EchoTik dashboard/API docs.`,
    'ECHOTIK_REQUEST_FAILED'
  );
}

export const EchoTikService = {
  async listInfluencers(region = 'US', pageNum = 1, pageSize = 10): Promise<EchoTikInfluencer[]> {
    return echotikGet<EchoTikInfluencer[]>(INFLUENCER_LIST_PATHS, {
      region,
      page_num: Math.max(1, pageNum),
      page_size: Math.min(10, Math.max(1, pageSize)),
    });
  },

  async listInfluencerLives(userId: string, pageNum = 1, pageSize = 10): Promise<EchoTikLiveStream[]> {
    if (!userId.trim()) {
      throw new AppError(400, 'userId is required', 'VALIDATION_ERROR');
    }
    return echotikGet<EchoTikLiveStream[]>(INFLUENCER_LIVE_LIST_PATHS, {
      user_id: userId.trim(),
      page_num: Math.max(1, pageNum),
      page_size: Math.min(10, Math.max(1, pageSize)),
    });
  },
};
