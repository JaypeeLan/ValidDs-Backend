import * as crypto from 'crypto';
import { User, IUserDocument, AuthProvider } from '../models/user.model';
import { signJWT, verifyJWT } from '../security/jwt';
import { logger } from '../logger';
import { AppError, UnauthorizedError } from '../middleware/error.middleware';
import { EmailService } from './email.service';

const log = logger.child({ module: 'auth-service' });

/**
 * Auth Service
 *
 * Handles all authentication logic:
 *  - Google OAuth sign-in / sign-up (primary flow)
 *  - Local email + password (secondary flow)
 *  - JWT token issuance and refresh
 *  - Password hashing and verification (using native crypto — no bcrypt dep)
 *
 * Google OAuth flow:
 *  1. Frontend redirects user to Google consent screen
 *  2. Google redirects back with a code to GET /api/v1/auth/google/callback
 *  3. This service exchanges the code for a Google profile
 *  4. We find or create a User record, issue a JWT, return it
 *
 * The JWT contains: { sub: userId, role, plan }
 * It is verified on every protected request by requireJWT middleware.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface AuthResult {
  user: IUserDocument;
  token: string;
  isNewUser: boolean;
}

export interface TokenPayload {
  sub: string;
  role: string;
  plan: string;
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

export const AuthService = {

  /**
   * Find or create a user from a verified Google profile.
   * Called after Google OAuth callback verifies the code.
   *
   * Logic:
   *  1. Look up by googleId — returning user → update tokens + login stats
   *  2. Look up by email — existing local user → link Google account
   *  3. No match → create new user
   */
  async googleSignIn(profile: GoogleProfile, ip?: string): Promise<AuthResult> {
    let user = await User.findByGoogleId(profile.googleId);
    let isNewUser = false;

    if (!user) {
      // Check if email exists under a different auth provider
      user = await User.findByEmail(profile.email);

      if (user) {
        // Link Google auth to existing account
        user.authProvider = 'google';
        user.googleAuth = {
          googleId: profile.googleId,
          refreshToken: profile.refreshToken,
        };
        log.info('Linked Google account to existing user', { userId: user.id });
      } else {
        // New user — create account
        user = new User({
          email: profile.email,
          name: profile.name,
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatarUrl: profile.avatarUrl,
          authProvider: 'google' as AuthProvider,
          googleAuth: {
            googleId: profile.googleId,
            refreshToken: profile.refreshToken,
          },
        });
        isNewUser = true;
        log.info('New user created via Google OAuth', { email: profile.email });
      }
    }

    // Update login stats
    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    user.loginCount = (user.loginCount ?? 0) + 1;

    await user.save();

    const token = AuthService.issueToken(user);
    return { user, token, isNewUser };
  },

  /**
   * Exchange a Google OAuth authorization code for a user profile.
   * Calls Google's token endpoint, then the userinfo endpoint.
   *
   * This requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.
   */
  async exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new AppError(500, 'Google OAuth not configured', 'OAUTH_NOT_CONFIGURED');
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      log.warn('Google token exchange failed', { status: tokenRes.status });
      throw new UnauthorizedError('Google authentication failed');
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      id_token: string;
    };

    // Fetch user profile from Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      throw new UnauthorizedError('Failed to fetch Google profile');
    }

    const googleUser = await profileRes.json() as {
      id: string;
      email: string;
      name: string;
      given_name?: string;
      family_name?: string;
      picture?: string;
    };

    return {
      googleId: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      firstName: googleUser.given_name,
      lastName: googleUser.family_name,
      avatarUrl: googleUser.picture,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  },

  async verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new AppError(500, 'Google OAuth not configured', 'OAUTH_NOT_CONFIGURED');
    }

    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      method: 'GET',
    });

    if (!res.ok) {
      throw new UnauthorizedError('Google authentication failed');
    }

    const payload = await res.json() as {
      aud?: string;
      sub?: string;
      email?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
      picture?: string;
      email_verified?: string;
    };

    if (!payload.sub || !payload.email) {
      throw new UnauthorizedError('Google authentication failed');
    }

    if (payload.aud !== clientId) {
      throw new UnauthorizedError('Google authentication failed');
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email,
      firstName: payload.given_name,
      lastName: payload.family_name,
      avatarUrl: payload.picture,
    };
  },

  // ── TikTok OAuth ───────────────────────────────────────────────────────────

  async exchangeTikTokCode(code: string, redirectUri: string): Promise<{
    openId: string;
    unionId?: string;
    displayName: string;
    avatarUrl?: string;
  }> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
      throw new AppError(500, 'TikTok OAuth not configured', 'OAUTH_NOT_CONFIGURED');
    }

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      throw new UnauthorizedError('TikTok authentication failed');
    }

    const tokenJson = await tokenRes.json() as {
      access_token?: string;
      open_id?: string;
      data?: { access_token?: string; open_id?: string };
    };

    const accessToken = tokenJson.access_token ?? tokenJson.data?.access_token;
    const openId = tokenJson.open_id ?? tokenJson.data?.open_id;
    if (!accessToken || !openId) {
      throw new UnauthorizedError('TikTok authentication failed');
    }

    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      throw new UnauthorizedError('TikTok authentication failed');
    }

    const userJson = await userRes.json() as {
      data?: {
        user?: {
          open_id?: string;
          union_id?: string;
          display_name?: string;
          avatar_url?: string;
        };
      };
    };

    const user = userJson.data?.user;
    if (!user?.open_id) {
      throw new UnauthorizedError('TikTok authentication failed');
    }

    return {
      openId: user.open_id,
      unionId: user.union_id,
      displayName: user.display_name ?? 'TikTok User',
      avatarUrl: user.avatar_url,
    };
  },

  async tiktokSignIn(profile: { openId: string; unionId?: string; displayName: string; avatarUrl?: string }, ip?: string): Promise<AuthResult> {
    let user = await User.findByTikTokOpenId(profile.openId);
    let isNewUser = false;

    if (!user) {
      const syntheticEmail = `tiktok_${profile.openId}@tiktok.local`;
      user = new User({
        email: syntheticEmail,
        name: profile.displayName,
        avatarUrl: profile.avatarUrl,
        authProvider: 'tiktok' as AuthProvider,
        tiktokAuth: {
          openId: profile.openId,
          unionId: profile.unionId,
        },
      });
      isNewUser = true;
      log.info('New user created via TikTok OAuth', { openId: profile.openId });
    } else {
      user.authProvider = 'tiktok';
      user.tiktokAuth = {
        openId: profile.openId,
        unionId: profile.unionId,
      };
    }

    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    user.loginCount = (user.loginCount ?? 0) + 1;
    await user.save();

    const token = AuthService.issueToken(user);
    return { user, token, isNewUser };
  },

  /**
   * Build the Google OAuth consent URL.
   * Frontend redirects the user to this URL to begin the OAuth flow.
   */
  getGoogleAuthUrl(redirectUri: string, state?: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new AppError(500, 'Google OAuth not configured', 'OAUTH_NOT_CONFIGURED');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',     // Request refresh token
      prompt: 'select_account',   // Always show account picker
      ...(state ? { state } : {}),
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  // ── Local auth ──────────────────────────────────────────────────────────────

  async startEmailRegistration(email: string): Promise<{ isNewUser: boolean }> {
    const normalizedEmail = email.toLowerCase();
    let user = await User.findOne({ email: normalizedEmail, status: 'active' }).select('+localAuth');
    let isNewUser = false;

    if (user) {
      if (user.authProvider !== 'local') {
        throw new AppError(409, 'An account with this email already exists', 'EMAIL_IN_USE');
      }
      if (user.localAuth?.passwordHash) {
        throw new AppError(409, 'An account with this email already exists', 'EMAIL_IN_USE');
      }
      if (!user.localAuth) {
        user.localAuth = { emailVerified: false };
        await user.save();
      }
    } else {
      user = new User({
        email: normalizedEmail,
        name: deriveNameFromEmail(normalizedEmail),
        authProvider: 'local' as AuthProvider,
        localAuth: {
          emailVerified: false,
        },
        loginCount: 0,
      });
      await user.save();
      isNewUser = true;
    }

    await AuthService.sendEmailVerificationCode(user.id);
    return { isNewUser };
  },

  async verifyEmailCode(
    email: string,
    code: string,
  ): Promise<void> {
    const user = await User.findOne({ email: email.toLowerCase(), status: 'active' }).select(
      '+localAuth'
    );

    if (!user || user.authProvider !== 'local' || !user.localAuth) {
      throw new AppError(400, 'Invalid verification code', 'INVALID_CODE');
    }

    const expiresAt = user.localAuth.emailVerificationExpiresAt;
    const codeHash = user.localAuth.emailVerificationCodeHash;
    if (!expiresAt || !codeHash) {
      throw new AppError(400, 'Invalid verification code', 'INVALID_CODE');
    }
    if (expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'Verification code expired', 'CODE_EXPIRED');
    }
    if (!timingSafeEqualHex(codeHash, hashToken(code))) {
      throw new AppError(400, 'Invalid verification code', 'INVALID_CODE');
    }

    user.localAuth.emailVerified = true;
    user.localAuth.emailVerificationCodeHash = undefined;
    user.localAuth.emailVerificationExpiresAt = undefined;
    await user.save();
  },

  async completeEmailRegistration(
    email: string,
    password: string,
    name: string,
    ip?: string
  ): Promise<AuthResult> {
    const user = await User.findOne({ email: email.toLowerCase(), status: 'active' }).select(
      '+localAuth'
    );

    if (!user || user.authProvider !== 'local' || !user.localAuth) {
      throw new AppError(400, 'Registration cannot be completed for this account', 'REGISTRATION_NOT_ALLOWED');
    }
    if (!user.localAuth.emailVerified) {
      throw new AppError(400, 'Email must be verified before completing registration', 'EMAIL_NOT_VERIFIED');
    }
    if (user.localAuth.passwordHash) {
      throw new AppError(409, 'Registration already completed for this account', 'REGISTRATION_ALREADY_COMPLETED');
    }

    AuthService.validatePassword(password);
    user.localAuth.passwordHash = await hashPassword(password);

    user.name = name.trim();

    const isNewUser = (user.loginCount ?? 0) === 0;
    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    user.loginCount = (user.loginCount ?? 0) + 1;

    await user.save();

    const token = AuthService.issueToken(user);
    return { user, token, isNewUser };
  },

  /**
   * Register with email and password.
   */
  async localRegister(
    email: string,
    password: string,
    name: string,
    ip?: string
  ): Promise<AuthResult> {
    const existing = await User.findByEmail(email);
    if (existing) {
      throw new AppError(409, 'An account with this email already exists', 'EMAIL_IN_USE');
    }

    AuthService.validatePassword(password);

    const passwordHash = await hashPassword(password);
    const user = new User({
      email,
      name,
      authProvider: 'local' as AuthProvider,
      localAuth: {
        passwordHash,
        emailVerified: false,
        emailVerificationToken: crypto.randomBytes(32).toString('hex'),
      },
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      loginCount: 1,
    });

    await user.save();
    log.info('New user registered via local auth', { email });

    const token = AuthService.issueToken(user);
    return { user, token, isNewUser: true };
  },

  /**
   * Sign in with email and password.
   */
  async localSignIn(email: string, password: string, ip?: string): Promise<AuthResult> {
    // Fetch with passwordHash (select: false by default)
    const user = await User.findOne({ email: email.toLowerCase(), status: 'active' })
      .select('+localAuth');

    if (!user) {
      throw new UnauthorizedError('Email not found');
    }

    if (!user.localAuth?.passwordHash) {
      throw new UnauthorizedError('This account does not have a password set (use social login)');
    }

    const valid = await verifyPassword(password, user.localAuth.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Incorrect password');
    }

    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    user.loginCount = (user.loginCount ?? 0) + 1;
    await user.save();

    const token = AuthService.issueToken(user);
    return { user, token, isNewUser: false };
  },

  async sendEmailVerificationCode(userId: string): Promise<void> {
    const user = await User.findById(userId).select('+localAuth');
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'Account not found', 'NOT_FOUND');
    }
    if (user.authProvider !== 'local' || !user.localAuth) {
      throw new AppError(400, 'Email verification is only available for local accounts', 'INVALID_AUTH_PROVIDER');
    }

    const { code, hash, expiresAt } = createVerificationCode();
    user.localAuth.emailVerificationCodeHash = hash;
    user.localAuth.emailVerificationExpiresAt = expiresAt;
    await user.save();

    await EmailService.sendEmail({
      to: user.email,
      subject: 'Your verification code',
      html: `<p>Your verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
    });
  },

  async requestPasswordReset(email: string): Promise<void> {
    const user = await User.findOne({ email: email.toLowerCase(), status: 'active' }).select(
      '+localAuth.passwordResetToken +localAuth.passwordResetExpiresAt +localAuth.passwordHash'
    );

    if (!user) {
      return;
    }

    const { code, hash, expiresAt } = createVerificationCode();
    
    // Initialize localAuth if it doesn't exist (for social-login users)
    if (!user.localAuth) {
      user.localAuth = { emailVerified: true };
    }

    user.localAuth.passwordResetToken = hash;
    user.localAuth.passwordResetExpiresAt = expiresAt;
    
    await user.save();

    await EmailService.sendEmail({
      to: user.email,
      subject: 'Reset your password',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Reset Your Password</h2>
          <p>You requested to reset your password for your ValidDs account.</p>
          <p>Please enter the following 6-digit code on the reset page:</p>
          <div style="margin: 30px 0; background: #f4f4f4; padding: 20px; border-radius: 8px; text-align: center;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #e63946;">${code}</span>
          </div>
          <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="font-size: 12px; color: #999;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });
  },

  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    console.log(`[AUTH] Attempting password reset for: ${email}`);
    
    const user = await User.findOne({ email: email.toLowerCase(), status: 'active' }).select(
      '+localAuth'
    );

    if (!user || !user.localAuth) {
      console.log('[AUTH] Reset failed: User or localAuth not found');
      throw new AppError(400, 'Invalid reset token', 'INVALID_RESET_TOKEN');
    }

    const expiresAt = user.localAuth.passwordResetExpiresAt;
    const storedHash = user.localAuth.passwordResetToken;
    
    console.log('[AUTH] Found stored hash:', !!storedHash);
    console.log('[AUTH] Found expiry:', !!expiresAt);

    if (!expiresAt || !storedHash) {
      console.log('[AUTH] Reset failed: Missing token or expiry in DB');
      throw new AppError(400, 'Invalid reset token', 'INVALID_RESET_TOKEN');
    }
    if (expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'Reset token expired', 'RESET_TOKEN_EXPIRED');
    }
    if (!timingSafeEqualHex(storedHash, hashToken(token))) {
      throw new AppError(400, 'Invalid reset token', 'INVALID_RESET_TOKEN');
    }

    AuthService.validatePassword(newPassword);
    user.localAuth.passwordHash = await hashPassword(newPassword);
    user.localAuth.passwordResetToken = undefined;
    user.localAuth.passwordResetExpiresAt = undefined;
    
    // Explicitly mark localAuth as modified to ensure Mongoose saves the nested object
    user.markModified('localAuth');
    await user.save();
    console.log('[AUTH] Password reset successful and saved to DB');
  },

  // ── Token management ────────────────────────────────────────────────────────

  issueToken(user: IUserDocument): string {
    return signJWT({
      sub: user.id,
      role: user.role,
      plan: user.plan,
    });
  },

  verifyToken(token: string): TokenPayload {
    const result = verifyJWT(token);
    if (!result.valid || !result.payload) {
      throw new UnauthorizedError(result.expired ? 'Token expired' : 'Invalid token');
    }
    return result.payload as unknown as TokenPayload;
  },

  // ── Helpers ─────────────────────────────────────────────────────────────────

  validatePassword(password: string): void {
    if (password.length < 8) {
      throw new AppError(400, 'Password must be at least 8 characters', 'WEAK_PASSWORD');
    }
    if (!/[A-Z]/.test(password)) {
      throw new AppError(400, 'Password must contain at least one uppercase letter', 'WEAK_PASSWORD');
    }
    if (!/[0-9]/.test(password)) {
      throw new AppError(400, 'Password must contain at least one number', 'WEAK_PASSWORD');
    }
  },
};

// ── Password hashing (native crypto — no bcrypt) ──────────────────────────────

// Use 1,000 iterations for tests to stay under timeout, otherwise use production standard
const ITERATIONS = process.env.NODE_ENV === 'test' ? 1000 : 310_000;
const KEYLEN = 32;
const DIGEST = 'sha256';

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEYLEN, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `${salt}:${ITERATIONS}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, iters, storedHash] = stored.split(':');
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, parseInt(iters, 10), KEYLEN, DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return crypto.timingSafeEqual(
    Buffer.from(storedHash, 'hex'),
    hash
  );
}

// Prevents timing-based user enumeration on failed logins
async function dummyHashCompare(): Promise<void> {
  await verifyPassword('dummy', `aabbcc:${ITERATIONS}:${'00'.repeat(KEYLEN)}`).catch(() => {});
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createVerificationCode(): { code: string; hash: string; expiresAt: Date } {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  return {
    code,
    hash: hashToken(code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  };
}

function deriveNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'User';
  const base = local.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  const words = base ? base.split(/\s+/) : ['User'];
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 100) || 'User';
}
