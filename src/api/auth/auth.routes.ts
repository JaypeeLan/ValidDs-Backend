import { Router } from 'express';
import { AuthController } from './auth.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { strictLimiter } from '../../middleware/rate-limit.middleware';
import {
  RegisterSchema,
  LoginSchema,
  GoogleIdTokenSchema,
  TikTokCodeSchema,
  VerifyEmailCodeSchema,
  CompleteRegistrationSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from './auth.validator';

const router = Router();

/**
 * Auth Routes
 *
 * Public:
 *  GET  /auth/google              → Start Google OAuth flow (browser redirect)
 *  GET  /auth/google/callback     → Google OAuth callback (browser redirect)
 *  POST /auth/register            → Start local registration (email only, sends 6-digit code)
 *  POST /auth/email/verify-code   → Verify email code (email + code)
 *  POST /auth/register/complete   → Complete local registration (email + full name + password)
 *  POST /auth/login               → Local login
 *
 * Protected:
 *  GET  /auth/me                  → Get current user (requires JWT)
 *  POST /auth/logout              → Logout (requires JWT)
 *
 * Rate limiting: strict limiter on register + login (10 req / 15min)
 */

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get('/google', AuthController.googleRedirect);
router.get('/google/callback', AuthController.googleCallback);
router.post('/google/token', strictLimiter, validate(GoogleIdTokenSchema, 'body'), AuthController.googleIdToken);

// ── Local auth ────────────────────────────────────────────────────────────────
router.post(
  '/register',
  strictLimiter,
  validate(RegisterSchema, 'body'),
  AuthController.register
);

router.post(
  '/login',
  strictLimiter,
  validate(LoginSchema, 'body'),
  AuthController.login
);

router.post('/email/send-code', requireAuth, strictLimiter, AuthController.sendVerificationCode);
router.post('/email/verify-code', strictLimiter, validate(VerifyEmailCodeSchema, 'body'), AuthController.verifyEmailCode);
router.post('/register/complete', strictLimiter, validate(CompleteRegistrationSchema, 'body'), AuthController.completeRegistration);

router.post('/forgot-password', strictLimiter, validate(ForgotPasswordSchema, 'body'), AuthController.forgotPassword);
router.post('/reset-password', strictLimiter, validate(ResetPasswordSchema, 'body'), AuthController.resetPassword);

router.post('/tiktok', strictLimiter, validate(TikTokCodeSchema, 'body'), AuthController.tiktok);

// ── Protected ────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, AuthController.me);
router.post('/logout', requireAuth, AuthController.logout);

export default router;
