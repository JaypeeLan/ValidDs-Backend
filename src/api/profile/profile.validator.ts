import { z } from 'zod';
import { ALLOWED_CONTENT_REGIONS } from '../../models/user.model';

export const UpdateProfileSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  firstName: z.string().min(1).max(50).trim().optional(),
  lastName: z.string().min(1).max(50).trim().optional(),
  avatarUrl: z.string().url().optional(),
  timezone: z.string().min(1).max(50).optional(),
  locale: z.string().min(2).max(10).optional(),
  contentRegion: z.enum(ALLOWED_CONTENT_REGIONS).optional(),
  notifications: z
    .object({
      emailOnNewTrend: z.boolean().optional(),
      emailOnSavedProductUpdate: z.boolean().optional(),
      emailMarketing: z.boolean().optional(),
    })
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const ContentRegionSchema = z.object({
  contentRegion: z.enum(ALLOWED_CONTENT_REGIONS),
});

export type ContentRegionInput = z.infer<typeof ContentRegionSchema>;

export const AddBookmarkSchema = z.object({
  productId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product ID'),
  notes: z.string().max(500).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

export type AddBookmarkInput = z.infer<typeof AddBookmarkSchema>;

