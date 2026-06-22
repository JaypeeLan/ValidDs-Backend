import { z } from 'zod';
import { ALLOWED_CONTENT_REGIONS } from '../../models/user.model';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

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

export const AddBookmarkSchema = z
  .object({
    productId: objectIdSchema.optional(),
    creativeId: objectIdSchema.optional(),
    notes: z.string().max(500).optional(),
    tags: z.array(z.string().max(50)).max(10).optional(),
  })
  .superRefine((val, ctx) => {
    const hasProduct = Boolean(val.productId);
    const hasCreative = Boolean(val.creativeId);
    if (hasProduct === hasCreative) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of productId or creativeId',
        path: ['productId'],
      });
    }
  });

export type AddBookmarkInput = z.infer<typeof AddBookmarkSchema>;

export const RemoveBookmarkParamsSchema = z.object({
  id: objectIdSchema,
});

export const RemoveBookmarkQuerySchema = z.object({
  kind: z.enum(['product', 'creative']).default('product'),
});

export type RemoveBookmarkQuery = z.infer<typeof RemoveBookmarkQuerySchema>;

export const CloseAccountSchema = z.object({
  password: z.string().min(1).optional(),
  confirmEmail: z.string().email().optional(),
});

export type CloseAccountInput = z.infer<typeof CloseAccountSchema>;

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
