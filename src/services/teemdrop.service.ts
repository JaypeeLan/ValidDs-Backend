import axios from 'axios';
import { createHmac } from 'crypto';
import { env } from '../config/env.validation';
import { logger } from '../logger';
import {
  TeemDropApiResponse,
  TeemDropProductDetail,
  TeemDropProductListData,
  TeemDropProductListItem,
  TeemDropResolvedProduct,
  TeemDropTokenPayload,
} from './teemdrop.types';

const log = logger.child({ module: 'teemdrop-service' });

const CREATE_TOKEN_PATH = '/openapi/createToken/v1';
const PRODUCT_LIST_PATH = '/openapi/product/list/v1';
const PRODUCT_DETAIL_PATH = '/openapi/product/detail/v1';
const REQUEST_TIMEOUT_MS = 15000;
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 5;
const EARLY_EXIT_SCORE = 0.85;
const MIN_MATCH_SCORE = 0.35;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

let cachedToken: { token: string; expireTime: number } | null = null;

function getConfig():
  | {
      appKey: string;
      appSecret: string;
      baseUrl: string;
      userAgent: string;
    }
  | null {
  if (!env.TEEMDROP_APP_KEY || !env.TEEMDROP_APP_SECRET) {
    return null;
  }

  return {
    appKey: env.TEEMDROP_APP_KEY,
    appSecret: env.TEEMDROP_APP_SECRET,
    baseUrl: env.TEEMDROP_BASE_URL,
    userAgent: env.TEEMDROP_USER_AGENT,
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function scoreCatalogCandidate(searchTerm: string, candidate: string): number {
  const normalizedSearch = normalizeText(searchTerm);
  const normalizedCandidate = normalizeText(candidate);

  if (!normalizedSearch || !normalizedCandidate) {
    return 0;
  }

  if (normalizedSearch === normalizedCandidate) {
    return 1;
  }

  const searchTokens = [...new Set(tokenize(normalizedSearch))];
  const candidateTokens = [...new Set(tokenize(normalizedCandidate))];

  if (searchTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const overlap = searchTokens.filter((token) => candidateSet.has(token)).length;
  const coverage = overlap / searchTokens.length;
  const precision = overlap / candidateTokens.length;

  let score = (coverage * 0.7) + (precision * 0.3);

  if (
    normalizedCandidate.includes(normalizedSearch) ||
    normalizedSearch.includes(normalizedCandidate)
  ) {
    score += 0.2;
  }

  const prefix = searchTokens.slice(0, Math.min(2, searchTokens.length)).join(' ');
  if (prefix && normalizedCandidate.includes(prefix)) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

function pickBestCatalogMatch(
  searchTerm: string,
  pageNum: number,
  items: TeemDropProductListItem[]
):
  | {
      item: TeemDropProductListItem;
      pageNum: number;
      score: number;
      matchedTitle: string;
    }
  | null {
  let bestMatch:
    | {
        item: TeemDropProductListItem;
        pageNum: number;
        score: number;
        matchedTitle: string;
      }
    | null = null;

  for (const item of items) {
    const englishTitle = item.productNameEn?.trim() || '';
    const nativeTitle = item.productName?.trim() || '';
    const englishScore = scoreCatalogCandidate(searchTerm, englishTitle);
    const nativeScore = scoreCatalogCandidate(searchTerm, nativeTitle);
    const score = Math.max(englishScore, nativeScore);
    const matchedTitle = englishScore >= nativeScore ? englishTitle : nativeTitle;

    if (!matchedTitle || score === 0) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        item,
        pageNum,
        score,
        matchedTitle,
      };
    }
  }

  return bestMatch;
}

function buildSignedAuthHeaders(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  appSecret: string,
  token: string,
  userAgent: string
): Record<string, string> {
  const bodyString = JSON.stringify(body);
  const timestamp = Date.now();
  const canonical = `body=${bodyString}&path=${path}&secret=${appSecret}&timestamp=${timestamp}`;
  const signatureHex = createHmac('sha256', token).update(canonical, 'utf8').digest('hex');
  const apiSign = Buffer.from(
    `${apiKey}|${token}|${timestamp}|${signatureHex}`,
    'utf8'
  ).toString('base64');

  return {
    Accept: 'application/json',
    'API-KEY': apiKey,
    'API-SIGN': apiSign,
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
  };
}

async function createToken(): Promise<TeemDropTokenPayload | null> {
  const config = getConfig();

  if (!config) {
    log.debug('TeemDrop credentials are not configured. Skipping TeemDrop lookup.');
    return null;
  }

  const url = `${config.baseUrl}${CREATE_TOKEN_PATH}`;
  const apiKeyBody = /^\d+$/.test(config.appKey) ? Number(config.appKey) : config.appKey;

  try {
    const response = await axios.post<TeemDropApiResponse<TeemDropTokenPayload>>(
      url,
      {
        apiKey: apiKeyBody,
        apiSecret: config.appSecret,
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': config.userAgent,
        },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    if (!response.data.success || response.data.code !== 0 || !response.data.data?.token) {
      log.warn('TeemDrop createToken returned an unsuccessful response', {
        code: response.data.code,
        message: response.data.message,
      });
      return null;
    }

    cachedToken = {
      token: response.data.data.token,
      expireTime: response.data.data.expireTime,
    };

    return response.data.data;
  } catch (error: any) {
    log.warn('TeemDrop createToken request failed', {
      error: error.message,
      status: error.response?.status,
    });
    return null;
  }
}

async function getActiveToken(): Promise<string | null> {
  if (
    cachedToken &&
    cachedToken.expireTime - TOKEN_REFRESH_BUFFER_MS > Date.now()
  ) {
    return cachedToken.token;
  }

  const tokenPayload = await createToken();
  return tokenPayload?.token ?? null;
}

async function signedPost<T>(
  path: string,
  body: Record<string, unknown>,
  retryOnUnauthorized = true
): Promise<TeemDropApiResponse<T> | null> {
  const config = getConfig();

  if (!config) {
    return null;
  }

  const token = await getActiveToken();

  if (!token) {
    return null;
  }

  try {
    const response = await axios.post<TeemDropApiResponse<T>>(
      `${config.baseUrl}${path}`,
      body,
      {
        headers: buildSignedAuthHeaders(
          path,
          body,
          config.appKey,
          config.appSecret,
          token,
          config.userAgent
        ),
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    if (!response.data.success || response.data.code !== 0) {
      log.warn('TeemDrop signed request returned an unsuccessful response', {
        path,
        code: response.data.code,
        message: response.data.message,
      });
      return null;
    }

    return response.data;
  } catch (error: any) {
    const status = error.response?.status;

    if (status === 401 && retryOnUnauthorized) {
      cachedToken = null;
      return signedPost(path, body, false);
    }

    log.warn('TeemDrop signed request failed', {
      path,
      error: error.message,
      status,
    });
    return null;
  }
}

export const TeemDropService = {
  async listProducts(
    pageNum: number,
    pageSize = SEARCH_PAGE_SIZE
  ): Promise<TeemDropProductListData | null> {
    const response = await signedPost<TeemDropProductListData>(PRODUCT_LIST_PATH, {
      pageNum,
      pageSize,
    });

    return response?.data ?? null;
  },

  async getProductDetail(productId: string): Promise<TeemDropProductDetail | null> {
    const response = await signedPost<TeemDropProductDetail>(PRODUCT_DETAIL_PATH, {
      productId,
    });

    return response?.data ?? null;
  },

  async findProductDetailByName(searchTerm: string): Promise<TeemDropResolvedProduct | null> {
    if (!searchTerm.trim()) {
      return null;
    }

    if (!getConfig()) {
      return null;
    }

    let bestMatch:
      | {
          item: TeemDropProductListItem;
          pageNum: number;
          score: number;
          matchedTitle: string;
        }
      | null = null;

    for (let pageNum = 1; pageNum <= SEARCH_MAX_PAGES; pageNum += 1) {
      const page = await this.listProducts(pageNum, SEARCH_PAGE_SIZE);

      if (!page?.data?.length) {
        break;
      }

      const pageBestMatch = pickBestCatalogMatch(searchTerm, pageNum, page.data);

      if (pageBestMatch && (!bestMatch || pageBestMatch.score > bestMatch.score)) {
        bestMatch = pageBestMatch;
      }

      if (bestMatch?.score && bestMatch.score >= EARLY_EXIT_SCORE) {
        break;
      }

      if (page.data.length < SEARCH_PAGE_SIZE) {
        break;
      }
    }

    if (!bestMatch || bestMatch.score < MIN_MATCH_SCORE) {
      log.debug('TeemDrop catalog did not return a confident enough match', {
        searchTerm,
        bestScore: bestMatch?.score ?? 0,
      });
      return null;
    }

    const detail = await this.getProductDetail(bestMatch.item.productId);

    if (!detail) {
      return null;
    }

    log.debug('TeemDrop product matched', {
      searchTerm,
      productId: detail.productId,
      score: bestMatch.score,
      pageNum: bestMatch.pageNum,
    });

    return {
      product: detail,
      match: {
        score: bestMatch.score,
        pageNum: bestMatch.pageNum,
        matchedTitle: bestMatch.matchedTitle,
        searchTerm,
      },
    };
  },
};
