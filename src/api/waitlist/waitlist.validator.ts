import { z } from 'zod';

export const JoinWaitlistSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  source: z.string().trim().max(64).optional(),
  referrer: z.string().trim().max(512).optional(),
});

export type JoinWaitlistInput = z.infer<typeof JoinWaitlistSchema>;
