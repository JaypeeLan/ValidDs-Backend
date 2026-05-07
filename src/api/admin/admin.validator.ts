import { z } from 'zod';

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

export const AdminProductIdParamSchema = z.object({
  productId: z.string().min(1, 'productId is required'),
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
