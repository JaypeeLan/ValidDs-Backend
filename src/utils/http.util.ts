import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from '../logger';

const log = logger.child({ module: 'http-util' });

/**
 * Axios wrapper with automatic retry, timeout, and structured error logging.
 *
 * Use this for ALL outbound HTTP requests (TikTok APIs, fallback sources, webhooks).
 * Never use raw axios or fetch directly in ingestion clients.
 *
 * Features:
 * - Configurable retry count with exponential backoff
 * - Request timeout
 * - Structured logging of retries and failures
 * - Throws a typed HttpRequestError on final failure
 */

export interface HttpRequestOptions extends AxiosRequestConfig {
  retries?: number;          // default: 3
  retryDelayMs?: number;     // base delay (doubles each retry), default: 500ms
  timeoutMs?: number;        // default: 10000ms
  context?: string;          // label for logs (e.g. 'tiktok-products')
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseData?: unknown
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

export async function httpRequest<T = unknown>(
  options: HttpRequestOptions
): Promise<AxiosResponse<T>> {
  const {
    retries = 3,
    retryDelayMs = 500,
    timeoutMs = 10000,
    context = 'http',
    ...axiosConfig
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await axios<T>({
        ...axiosConfig,
        timeout: timeoutMs,
      });

      if (attempt > 1) {
        log.info(`${context} request succeeded after ${attempt} attempts`);
      }

      return response;
    } catch (err) {
      lastError = err;

      if (!axios.isAxiosError(err)) {
        // Non-HTTP error (e.g. network error) — always retry
        log.warn(`${context} non-HTTP error on attempt ${attempt}`, { err: String(err) });
      } else {
        const statusCode = err.response?.status;

        // Don't retry 4xx errors (except the ones in RETRYABLE_STATUS_CODES)
        if (statusCode && statusCode < 500 && !RETRYABLE_STATUS_CODES.includes(statusCode)) {
          throw new HttpRequestError(
            `${context} request failed with status ${statusCode}`,
            statusCode,
            err.response?.data
          );
        }

        log.warn(`${context} request failed on attempt ${attempt}`, {
          statusCode,
          url: axiosConfig.url,
        });
      }

      if (attempt <= retries) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        log.debug(`${context} retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  if (axios.isAxiosError(lastError)) {
    throw new HttpRequestError(
      `${context} request failed after ${retries + 1} attempts`,
      lastError.response?.status,
      lastError.response?.data
    );
  }

  throw new HttpRequestError(`${context} request failed: ${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
