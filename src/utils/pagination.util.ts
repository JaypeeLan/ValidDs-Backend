/**
 * Pagination utilities.
 *
 * All paginated API endpoints use cursor-based or offset pagination.
 * This file provides the shared types and helpers used across all endpoints.
 */

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 150,
} as const;

/**
 * Parse and validate pagination query parameters.
 * Returns safe defaults if values are missing or out of range.
 */
export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const page = Math.max(1, parseInt(String(query.page ?? 1), 10) || 1);
  const limit = Math.min(
    PAGINATION_DEFAULTS.MAX_LIMIT,
    Math.max(1, parseInt(String(query.limit ?? PAGINATION_DEFAULTS.LIMIT), 10) || PAGINATION_DEFAULTS.LIMIT)
  );
  return { page, limit };
}

/**
 * Calculate MongoDB skip value from page/limit.
 */
export function toMongoSkip({ page, limit }: PaginationParams): number {
  return (page - 1) * limit;
}

/**
 * Build a standard paginated response envelope.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / params.limit);
  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPrevPage: params.page > 1,
    },
  };
}
