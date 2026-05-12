import { z } from 'zod';

/**
 * Validators for the Shopify store integration endpoints.
 */

export const ShopifyInstallQuerySchema = z.object({
  // Either accept the shop directly, e.g. "my-store.myshopify.com" or "my-store"
  shop: z.string().trim().min(1).optional(),
  // Optional return URL the frontend wants us to bounce back to after callback.
  returnTo: z.string().url().optional(),
});

export const ShopifyCallbackQuerySchema = z.object({
  code: z.string().min(1, 'code is required'),
  hmac: z.string().min(1, 'hmac is required'),
  shop: z.string().min(1, 'shop is required'),
  state: z.string().min(1, 'state is required'),
  timestamp: z.string().optional(),
  host: z.string().optional(),
}).passthrough();

export const ShopifyAddProductSchema = z.object({
  productId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'productId must be a valid MongoDB ObjectId'),
  // Optional client-side overrides
  price: z.coerce.number().positive().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
});

export type ShopifyInstallQuery = z.infer<typeof ShopifyInstallQuerySchema>;
export type ShopifyCallbackQuery = z.infer<typeof ShopifyCallbackQuerySchema>;
export type ShopifyAddProductInput = z.infer<typeof ShopifyAddProductSchema>;
