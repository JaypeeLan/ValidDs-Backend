import { z } from 'zod';

export const BillingTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['pending', 'paid', 'failed', 'refunded']).optional(),
});

export type BillingTransactionsQueryInput = z.infer<typeof BillingTransactionsQuerySchema>;
