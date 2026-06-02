/**
 * Product timestamps:
 * - `lastIngestedAt` — set on ingest / full refresh (not every patch).
 * - `updatedAt` — bumped whenever any other product field changes.
 */

export interface ProductItemFreshness {
  lastUpdatedAt: string;
  lastIngestedAt: string;
  updatedAt: string;
  freshnessLabel: string;
}

const TIMESTAMP_ONLY_KEYS = new Set([
  'lastIngestedAt',
  'dataSourceUpdatedAt',
  'updatedAt',
  'createdAt',
  '__v',
]);

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function freshnessLabelForAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function resolveProductFreshnessDate(product: Record<string, unknown>): Date {
  return (
    coerceDate(product.lastIngestedAt) ??
    coerceDate(product.updatedAt) ??
    coerceDate(product.createdAt) ??
    new Date()
  );
}

export function buildProductItemFreshness(
  product: Record<string, unknown>,
  nowMs: number = Date.now(),
): ProductItemFreshness {
  const lastIngested = coerceDate(product.lastIngestedAt) ?? resolveProductFreshnessDate(product);
  const updated = coerceDate(product.updatedAt) ?? lastIngested;
  const lastUpdatedAt = updated.toISOString();

  return {
    lastUpdatedAt,
    lastIngestedAt: lastIngested.toISOString(),
    updatedAt: updated.toISOString(),
    freshnessLabel: freshnessLabelForAge(Math.max(0, nowMs - lastIngested.getTime())),
  };
}

function setPayloadKeys(update: Record<string, unknown>): string[] {
  const setBlock =
    update.$set && typeof update.$set === 'object' && !Array.isArray(update.$set)
      ? (update.$set as Record<string, unknown>)
      : update;
  return Object.keys(setBlock).filter((k) => !k.startsWith('$') && !TIMESTAMP_ONLY_KEYS.has(k));
}

export function shouldTouchProductUpdatedAt(update: Record<string, unknown>): boolean {
  const keys = setPayloadKeys(update);
  const hasOtherOps = Boolean(
    update.$unset || update.$inc || update.$push || update.$pull || update.$addToSet,
  );

  if (keys.length === 0) return hasOtherOps;

  if (keys.length === 1 && keys[0] === 'status' && update.$set) {
    const status = (update.$set as Record<string, unknown>).status;
    if (status === 'stale') return false;
  }
  if (keys.length === 1 && keys[0] === 'status' && update.status === 'stale') {
    return false;
  }

  return true;
}

/** Bump `updatedAt` when product data changes (not on stale-only status flips). */
export function applyUpdatedAtToUpdate(update: Record<string, unknown>): void {
  if (!shouldTouchProductUpdatedAt(update)) return;

  const now = new Date();
  if (update.$set && typeof update.$set === 'object' && !Array.isArray(update.$set)) {
    (update.$set as Record<string, unknown>).updatedAt = now;
    return;
  }

  update.updatedAt = now;
}

export function ensureLastIngestedAtOnCreate(doc: {
  isNew?: boolean;
  lastIngestedAt?: Date;
}): void {
  if (doc.isNew && !doc.lastIngestedAt) {
    doc.lastIngestedAt = new Date();
  }
}

export function touchProductFreshnessOnUpdate(update: Record<string, unknown>): void {
  applyUpdatedAtToUpdate(update);
}
