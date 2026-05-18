import { z } from 'zod';
import { MARKET_CODES } from '../../utils/markets';

export const AdminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  role: z.enum(['user', 'admin']).optional(),
  plan: z.enum(['free', 'explorer', 'pro', 'premium']).optional(),
  q: z.string().trim().min(1).optional(),
});

export const AdminUserIdParamSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

export const UpdateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

// ── Market param — required on all content create/list/delete operations ──────

/** `z.enum` requires a non-empty tuple, so cast from the string[] constant. */
const MarketCodeEnum = z.enum(MARKET_CODES as [string, ...string[]]);

export const AdminProductIdParamSchema = z.object({
  productId: z.string().min(1, 'productId is required'),
});

// market is a query param on list/delete, body field on create
export const AdminMarketQuerySchema = z.object({
  market: MarketCodeEnum,
});

export const AdminProductsQuerySchema_v2 = z.object({
  market: MarketCodeEnum,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'archived', 'stale']).optional(),
  source: z.string().optional(),
  category: z.string().optional(),
  q: z.string().trim().min(1).optional(),
});

export const AdminDeleteContentParamSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

// Admin product create body — minimal fields; the rest come from ingestion
export const AdminCreateProductSchema = z.object({
  market:      MarketCodeEnum,
  title:       z.string().min(1).max(120),
  categoryL1:  z.string().min(1),
  categoryL2:  z.string().optional(),
  externalId:  z.string().min(1),
  source:      z.string().min(1).default('admin'),
  price:       z.number().min(0).optional(),
  currency:    z.string().length(3).default('USD'),
  productUrl:  z.string().url().optional(),
  shopName:    z.string().optional(),
  description: z.string().max(2000).optional(),
  primaryImageUrl: z.string().url().optional(),
});

// Admin creative create body
export const AdminCreateCreativeSchema = z.object({
  market:          MarketCodeEnum,
  productId:       z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  externalVideoId: z.string().min(1),
  videoPlayUrl:    z.string().url().optional(),
  thumbnailUrl:    z.string().url().optional(),
  isAd:            z.boolean().default(false),
  section:         z.enum(['store', 'affiliate', 'ads']).optional(),
  creatorHandle:   z.string().optional(),
  description:     z.string().max(2000).optional(),
});

// Analytics query — optionally scoped to a market; omit for all-markets aggregate
export const AdminAnalyticsQuerySchema = z.object({
  market: MarketCodeEnum.optional(),
});

export const AdminTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
  mode: z.enum(['test', 'live']).optional(),
});

export const AdminProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'archived', 'stale']).optional(),
  source: z.string().optional(),
  category: z.string().optional(),
  q: z.string().trim().min(1).optional(),
});

export const AdminWaitlistQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const CreateTransactionSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  userEmail: z.string().email().optional(),
  amount: z.coerce.number().min(0, 'amount must be at least 0'),
  currency: z.string().length(3).default('USD'),
  status: z.enum(['pending', 'paid', 'failed', 'refunded']).default('pending'),
  mode: z.enum(['test', 'live']).default('test'),
  provider: z.literal('stripe').default('stripe'),
  reference: z.string().min(1).optional(),
  stripePaymentIntentId: z.string().min(1).optional(),
  stripeCustomerId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type AdminTransactionsQueryInput = z.infer<typeof AdminTransactionsQuerySchema>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type AdminUsersQueryInput = z.infer<typeof AdminUsersQuerySchema>;
export type UpdateUserStatusInput = z.infer<typeof UpdateUserStatusSchema>;
export type AdminUserIdParamInput = z.infer<typeof AdminUserIdParamSchema>;
export type AdminProductIdParamInput = z.infer<typeof AdminProductIdParamSchema>;
export type AdminProductsQueryInput = z.infer<typeof AdminProductsQuerySchema>;
export type AdminWaitlistQueryInput = z.infer<typeof AdminWaitlistQuerySchema>;
export type AdminProductsQueryV2Input = z.infer<typeof AdminProductsQuerySchema_v2>;
export type AdminMarketQueryInput = z.infer<typeof AdminMarketQuerySchema>;
export type AdminDeleteContentParamInput = z.infer<typeof AdminDeleteContentParamSchema>;
export type AdminCreateProductInput = z.infer<typeof AdminCreateProductSchema>;
export type AdminCreateCreativeInput = z.infer<typeof AdminCreateCreativeSchema>;
export type AdminAnalyticsQueryInput = z.infer<typeof AdminAnalyticsQuerySchema>;
