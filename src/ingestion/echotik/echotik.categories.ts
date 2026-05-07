import { EchoTikClient, EchoTikCategoryRow } from './echotik.client';
import { CacheService } from '../../cache/cache.service';
import { CacheKeys, CACHE_TTL } from '../../cache/cache.keys';
import { logger } from '../../logger';

const log = logger.child({ module: 'echotik-categories' });

/**
 * In-memory store of resolved TikTok-Shop category names, populated from the
 * EchoTik category endpoints (`/category/l1`, `/l2`, `/l3`).
 *
 * Populated lazily on first lookup, persisted in Redis for 7 days, and re-used
 * synchronously by the transformer + product/creative response formatters so
 * we never expose raw numeric category IDs to API consumers.
 */

export interface CategoryEntry {
  name: string;
  level: 1 | 2 | 3;
  parentId?: string;
}

const DEFAULT_LANGUAGE = 'en-US';

const memory: Map<string, Map<string, CategoryEntry>> = new Map();
const inflight: Map<string, Promise<Map<string, CategoryEntry>>> = new Map();

function ensureMemory(language: string): Map<string, CategoryEntry> {
  let map = memory.get(language);
  if (!map) {
    map = new Map();
    memory.set(language, map);
  }
  return map;
}

function rowsToEntries(rows: EchoTikCategoryRow[]): Array<[string, CategoryEntry]> {
  return rows
    .filter((r) => r && r.category_id && r.category_name)
    .map((r) => {
      const level = Number(r.category_level) as 1 | 2 | 3;
      return [
        r.category_id,
        {
          name: r.category_name.trim(),
          level: level === 1 || level === 2 || level === 3 ? level : 1,
          parentId: r.parent_id || undefined,
        } satisfies CategoryEntry,
      ] as [string, CategoryEntry];
    });
}

async function loadFromApi(language: string): Promise<Map<string, CategoryEntry>> {
  const client = new EchoTikClient();
  const map = new Map<string, CategoryEntry>();

  const [l1, l2, l3] = await Promise.all([
    client.listCategoryL1(language),
    client.listCategoryL2(language),
    client.listCategoryL3(language),
  ]);

  for (const [id, entry] of rowsToEntries(l1)) map.set(id, entry);
  for (const [id, entry] of rowsToEntries(l2)) map.set(id, entry);
  for (const [id, entry] of rowsToEntries(l3)) map.set(id, entry);

  log.info('EchoTik category tree loaded', {
    language,
    l1: l1.length,
    l2: l2.length,
    l3: l3.length,
    total: map.size,
  });

  return map;
}

/**
 * Ensures the category tree for `language` is loaded into memory + Redis.
 * Safe to call repeatedly — concurrent callers share the same in-flight load.
 */
export async function ensureCategoriesLoaded(
  language: string = DEFAULT_LANGUAGE
): Promise<Map<string, CategoryEntry>> {
  const cached = memory.get(language);
  if (cached && cached.size > 0) return cached;

  const pending = inflight.get(language);
  if (pending) return pending;

  const promise = (async () => {
    const cacheKey = CacheKeys.echotikCategoryTree(language);

    const persisted = await CacheService.get<Array<[string, CategoryEntry]>>(cacheKey);
    if (persisted && persisted.length > 0) {
      const map = new Map(persisted);
      memory.set(language, map);
      log.debug('EchoTik category tree restored from Redis', { language, total: map.size });
      return map;
    }

    try {
      const map = await loadFromApi(language);
      memory.set(language, map);
      if (map.size > 0) {
        await CacheService.set(cacheKey, [...map.entries()], CACHE_TTL.ECHOTIK_CATEGORIES);
      }
      return map;
    } catch (err) {
      log.error('Failed to load EchoTik category tree', { language, err: String(err) });
      const empty = new Map<string, CategoryEntry>();
      memory.set(language, empty);
      return empty;
    } finally {
      inflight.delete(language);
    }
  })();

  inflight.set(language, promise);
  return promise;
}

/**
 * Synchronous lookup. Returns `undefined` if the category tree hasn't been
 * loaded yet or the id isn't part of the taxonomy. Callers that need the name
 * to be present should `await ensureCategoriesLoaded()` first.
 */
export function lookupCategoryName(
  id: string | undefined,
  language: string = DEFAULT_LANGUAGE
): string | undefined {
  if (!id) return undefined;
  const entry = ensureMemory(language).get(id);
  return entry?.name;
}

/**
 * Pre-warms the in-memory cache. Intended to be called once during server
 * startup; never throws.
 */
export async function warmCategoryCache(language: string = DEFAULT_LANGUAGE): Promise<void> {
  try {
    await ensureCategoriesLoaded(language);
  } catch (err) {
    log.warn('Category cache warm-up failed (non-fatal)', { err: String(err) });
  }
}

// ── Legacy-string sanitisation ────────────────────────────────────────────────

const LEGACY_NUMERIC_PATTERN = /^(?:Category|SubCategory)\s+(\d+)$/i;

/**
 * Older Product/Creative documents persisted strings like `"Category 600028"`
 * or `"SubCategory 914999"` because the static fallback used to embed the raw
 * id when an unknown category showed up. We extract the numeric id, try the
 * dynamic cache, and otherwise return `undefined` so the field is omitted.
 *
 * Plain (non-legacy) values like `"Beauty & Personal Care"` are passed through
 * untouched.
 */
export function sanitiseCategoryValue(
  value: unknown,
  language: string = DEFAULT_LANGUAGE
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(LEGACY_NUMERIC_PATTERN);
  if (!match) return trimmed;

  const id = match[1];
  return lookupCategoryName(id, language);
}

/**
 * Rebuilds a `categoryPath` from the (already-sanitised) level names. Returns
 * `undefined` when no level resolved.
 */
export function joinCategoryPath(
  l1?: string,
  l2?: string,
  l3?: string
): string | undefined {
  const parts = [l1, l2, l3].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' / ') : undefined;
}

/**
 * Rewrites the `categoryL1`/`categoryL2`/`categoryL3`/`categoryPath` fields on
 * a plain object in place. Used by the product + creative response formatters
 * so legacy `"Category 600028"` strings never reach the API consumer.
 */
export function sanitiseCategoryFields(
  obj: Record<string, unknown>,
  language: string = DEFAULT_LANGUAGE
): void {
  if (!obj) return;
  const l1 = sanitiseCategoryValue(obj.categoryL1, language);
  const l2 = sanitiseCategoryValue(obj.categoryL2, language);
  const l3 = sanitiseCategoryValue(obj.categoryL3, language);

  if (l1) obj.categoryL1 = l1;
  else delete obj.categoryL1;

  if (l2) obj.categoryL2 = l2;
  else delete obj.categoryL2;

  if (l3) obj.categoryL3 = l3;
  else delete obj.categoryL3;

  const existingPath = typeof obj.categoryPath === 'string' ? obj.categoryPath : undefined;
  const looksLegacy = existingPath ? LEGACY_NUMERIC_PATTERN.test(existingPath) || existingPath.split(' / ').some((p) => LEGACY_NUMERIC_PATTERN.test(p)) : false;

  if (!existingPath || looksLegacy) {
    const rebuilt = joinCategoryPath(l1, l2, l3);
    if (rebuilt) obj.categoryPath = rebuilt;
    else delete obj.categoryPath;
  }
}
