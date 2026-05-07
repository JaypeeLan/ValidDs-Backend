import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../services/auth.service';
import { AppError } from '../../middleware/error.middleware';
import { logger } from '../../logger';
import { ResponseMessage, successResponse } from '../../utils/response.util';

const log = logger.child({ module: 'auth-controller' });

/**
 * Auth Controller
 *
 * Handles:
 *  GET  /auth/google              → redirect to Google consent screen
 *  GET  /auth/google/callback     → handle Google OAuth callback
 *  POST /auth/register            → start email registration (send 6-digit code)
 *  POST /auth/email/verify-code   → verify the 6-digit email code
 *  POST /auth/register/complete   → complete registration with full name + password
 *  POST /auth/login               → local email + password sign-in
 *  GET  /auth/me                  → return current authenticated user
 *  POST /auth/logout              → client-side token invalidation (stateless)
 */

export const AuthController = {

  /**
   * GET /auth/google
   * Redirects the browser to Google's OAuth consent screen.
   */
  googleRedirect(req: Request, res: Response, next: NextFunction): void {
    try {
      const redirectUri = buildRedirectUri(req);
      // state param: can be used to pass a return URL from the frontend
      const state = req.query.returnTo ? encodeURIComponent(req.query.returnTo as string) : undefined;
      const url = AuthService.getGoogleAuthUrl(redirectUri, state);
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /auth/google/callback
   * Google redirects here after the user grants consent.
   * Exchanges the code for a profile, finds/creates the user, returns a JWT.
   */
  async googleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code, error, state } = req.query as Record<string, string>;

      if (error) {
        log.warn('Google OAuth error returned', { error });
        throw new AppError(400, 'Google sign-in was cancelled or failed', 'OAUTH_ERROR');
      }

      if (!code) {
        throw new AppError(400, 'Missing OAuth code', 'OAUTH_MISSING_CODE');
      }

      const redirectUri = buildRedirectUri(req);
      const profile = await AuthService.exchangeGoogleCode(code, redirectUri);
      const { user, token, isNewUser } = await AuthService.googleSignIn(profile, req.ip);

      log.info(`Google auth success — ${isNewUser ? 'new user' : 'returning user'}`, {
        userId: user.id,
      });

      // Determine where to redirect the frontend after auth
      const returnTo = state ? decodeURIComponent(state) : '/dashboard';

      // Option A (recommended): redirect to frontend with token in query param
      // The frontend should immediately store it and strip it from the URL.
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
      res.redirect(`${frontendUrl}/auth/callback?token=${token}&returnTo=${encodeURIComponent(returnTo)}&newUser=${isNewUser}`);

      // Option B (JSON API — for mobile or SPA that handles the OAuth flow itself):
      // res.json({ success: true, token, user: user.toJSON(), isNewUser });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /auth/register
   * Body: { email }
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body as Record<string, string>;
      const { isNewUser } = await AuthService.startEmailRegistration(email);
      res.status(200).json(successResponse({ sent: true, isNewUser }, ResponseMessage.REGISTRATION_STARTED, 200));
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /auth/login
   * Body: { email, password }
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as Record<string, string>;
      const { user, token } = await AuthService.localSignIn(email, password, req.ip);

      log.info('User logged in', { userId: user.id });

      res.json(
        successResponse(
          {
            token,
            user: user.toJSON(),
          },
          ResponseMessage.LOGIN_SUCCESS,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /auth/me
   * Returns the current authenticated user.
   * Protected by requireAuth middleware.
   */
  me(req: Request, res: Response): void {
    res.json(
      successResponse(
        { user: req.user!.toJSON() },
        ResponseMessage.PROFILE_RETRIEVED,
        200
      )
    );
  },

  /**
   * POST /auth/logout
   * JWTs are stateless — logout is handled client-side by deleting the token.
   * This endpoint exists for logging and any future token blocklist implementation.
   */
  logout(req: Request, res: Response): void {
    log.info('User logged out', { userId: req.user?.id });
    res.json(successResponse({ logged_out: true }, ResponseMessage.LOGOUT_SUCCESS, 200));
  },

  async googleIdToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { idToken } = req.body as Record<string, string>;
      const profile = await AuthService.verifyGoogleIdToken(idToken);
      const { user, token, isNewUser } = await AuthService.googleSignIn(profile, req.ip);

      res.json(
        successResponse(
          {
            token,
            user: user.toJSON(),
            isNewUser,
          },
          ResponseMessage.LOGIN_SUCCESS,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  async tiktok(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code, redirectUri } = req.body as Record<string, string>;
      const profile = await AuthService.exchangeTikTokCode(code, redirectUri);
      const { user, token, isNewUser } = await AuthService.tiktokSignIn(profile, req.ip);

      res.json({
        success: true,
        data: {
          token,
          user: user.toJSON(),
          isNewUser,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async sendVerificationCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await AuthService.sendEmailVerificationCode(req.user!.id);
      res.json({ success: true, data: { sent: true } });
    } catch (err) {
      next(err);
    }
  },

  async verifyEmailCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, code } = req.body as Record<string, string>;
      await AuthService.verifyEmailCode(email, code);
      res.json({ success: true, data: { verified: true } });
    } catch (err) {
      next(err);
    }
  },

  async completeRegistration(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, name } = req.body as Record<string, string>;
      const { user, token, isNewUser } = await AuthService.completeEmailRegistration(
        email,
        password,
        name.trim(),
        req.ip
      );
      res.json({ success: true, data: { token, user: user.toJSON(), isNewUser } });
    } catch (err) {
      next(err);
    }
  },

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body as Record<string, string>;
      await AuthService.requestPasswordReset(email);
      res.json({ success: true, data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, token, newPassword } = req.body as Record<string, string>;
      await AuthService.resetPassword(email, token, newPassword);
      res.json({ success: true, data: { ok: true } });
    } catch (err) {
      next(err);
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRedirectUri(req: Request): string {
  // Use configured redirect URI if set — otherwise derive from request
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const protocol = req.headers['x-forwarded-proto'] ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${protocol}://${host}/api/v1/auth/google/callback`;
}
