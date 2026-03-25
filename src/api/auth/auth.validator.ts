import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name is too long')
    .trim(),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const GoogleIdTokenSchema = z.object({
  idToken: z.string().min(1, 'idToken is required'),
});

export const TikTokCodeSchema = z.object({
  code: z.string().min(1, 'code is required'),
  redirectUri: z.string().url('redirectUri must be a valid URL'),
});

export const VerifyEmailCodeSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit number'),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
});

export const ResetPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  token: z.string().min(1, 'token is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type GoogleIdTokenInput = z.infer<typeof GoogleIdTokenSchema>;
export type TikTokCodeInput = z.infer<typeof TikTokCodeSchema>;
export type VerifyEmailCodeInput = z.infer<typeof VerifyEmailCodeSchema>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
