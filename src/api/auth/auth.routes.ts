import { Router } from 'express';
import { AuthController } from './auth.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
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
 *  POST /auth/register            → Local registration
 *  POST /auth/login               → Local login
 *
 * Protected:
 *  GET  /auth/me                  → Get current user (requires JWT)
 *  POST /auth/logout              → Logout (requires JWT)
 *
 */

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get('/google', AuthController.googleRedirect);
router.get('/google/callback', AuthController.googleCallback);
router.post('/google/token', validate(GoogleIdTokenSchema, 'body'), AuthController.googleIdToken);

// ── Local auth ────────────────────────────────────────────────────────────────
router.post(
  '/register',
  validate(RegisterSchema, 'body'),
  AuthController.register
);

router.post(
  '/login',
  validate(LoginSchema, 'body'),
  AuthController.login
);

router.post('/email/send-code', requireAuth, AuthController.sendVerificationCode);
router.post('/email/verify-code', validate(VerifyEmailCodeSchema, 'body'), AuthController.verifyEmailCode);
router.post('/register/complete', validate(CompleteRegistrationSchema, 'body'), AuthController.completeRegistration);

router.post('/forgot-password', validate(ForgotPasswordSchema, 'body'), AuthController.forgotPassword);
router.post('/reset-password', validate(ResetPasswordSchema, 'body'), AuthController.resetPassword);

router.post('/tiktok', validate(TikTokCodeSchema, 'body'), AuthController.tiktok);

// ── Protected ────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, AuthController.me);
router.post('/logout', requireAuth, AuthController.logout);

export default router;
