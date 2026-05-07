import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Authentication and Profile Integration Tests
 * 
 * Tests the end-to-end flow:
 * register -> verify email -> login -> fetch profile -> update profile
 */

interface ApiResponse {
  success: boolean;
  data: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

interface AddressInfoExtended extends AddressInfo {
  port: number;
}

// Simple helper to extract the 6-digit code from HTML email content
function extractSixDigitCode(html: string): string | null {
  const match = html.match(/>(\d{6})</);
  return match ? match[1] : null;
}

async function httpJson(opts: {
  baseUrl: string;
  method: string;
  path: string;
  body?: any;
  headers?: Record<string, string>;
}): Promise<{ status: number; json: ApiResponse; raw: string }> {
  try {
    const res = await fetch(opts.baseUrl + opts.path, {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const raw = await res.text();
    let json: any = {};
    try {
      if (raw) json = JSON.parse(raw);
    } catch (e) {
      json = {};
    }

    return {
      status: res.status,
      json: json as ApiResponse,
      raw,
    };
  } catch (err: any) {
    throw new Error(`httpJson failed: ${err.message}`);
  }
}

// Pre-set environment variables so they are available to all modules immediately
process.env.NODE_ENV = 'test';
process.env.INTERNAL_API_KEY = 'k'.repeat(32);
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.MONGODB_URI = 'mongodb://localhost:27017/test'; 

describe('Auth + Profile', () => {
  let mongo: MongoMemoryServer;
  let server: Server;
  let baseUrl: string;
  const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
  let disconnectMongoFn: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.PORT = '0';
    process.env.APP_NAME = 'validds-backend-test';
    process.env.API_VERSION = 'v1';
    process.env.JWT_EXPIRES_IN = '7d';
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3001';
    process.env.MONGODB_DB_NAME = 'validds_test';
    process.env.REDIS_URL = '';
    process.env.SENTRY_DSN = '';
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM = 'ValidDs <noreply@validds.test>';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.TIKTOK_CLIENT_KEY = 'tiktok-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'tiktok-client-secret';

    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    process.env.MONGODB_URI = mongo.getUri();

    // Store the ORIGINAL fetch before any mocking
    const originalFetch = global.fetch;

    global.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url;

      // Mock Resend API
      if (url.includes('api.resend.com/emails')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        sentEmails.push({
          to: body.to,
          subject: body.subject,
          html: body.html,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email-id' }),
          text: async () => JSON.stringify({ id: 'email-id' }),
        };
      }

      // Mock Google Token Info
      if (url.includes('googleapis.com/tokeninfo') || url.includes('oauth2/v3/tokeninfo')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            email: 'google.user@example.com',
            email_verified: 'true',
            name: 'Google User',
            given_name: 'Google',
            family_name: 'User',
            sub: 'google-sub-123',
            picture: 'https://example.com/pic.jpg',
            aud: 'google-client-id',
          }),
        };
      }

      // Mock TikTok Token/Info
      if (url.includes('tiktokapis.com/v2/oauth/token') || url.includes('tiktokapis.com/v2/user/info')) {
        if (url.includes('user/info')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                user: {
                  email: 'tiktok.user@example.com',
                  display_name: 'TikTok User',
                  avatar_url: 'https://example.com/tk.jpg',
                  open_id: 'tk-open-id',
                }
              }
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'tk-access-token',
            open_id: 'tk-open-id',
          }),
        };
      }

      // Call original fetch for internal server-to-server requests
      return originalFetch(input, init);
    }) as any;

    jest.resetModules();
    const { connectMongo, disconnectMongo } = await import('../src/db/client');
    await connectMongo();
    disconnectMongoFn = disconnectMongo;

    const { createApp } = await import('../src/app');
    const app = await createApp();
    server = app.listen(0);

    await new Promise<void>((resolve) => {
      server.on('listening', () => resolve());
    });

    const addr = server.address() as AddressInfoExtended;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 120000);

  afterAll(async () => {
    if (server) server.close();
    if (disconnectMongoFn) await disconnectMongoFn();
    if (mongo) await mongo.stop();
  });

  it('registers, sends + verifies email code, and fetches/updates profile', async () => {
    const email = 'local.user@example.com';
    const password = 'Password1';

    // 1. Register
    const registerRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/register',
      body: { email },
    });

    expect(registerRes.status).toBe(200);
    expect(registerRes.json.success).toBe(true);

    // 2. Get code
    const lastEmail = sentEmails.find(e => e.to === email);
    expect(lastEmail).toBeDefined();
    
    const verificationCode = extractSixDigitCode(lastEmail!.html);
    expect(verificationCode).toHaveLength(6);

    // 3. Complete registration
    const completeRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/email/verify-code',
      body: { 
        email, 
        code: verificationCode,
        password,
        firstName: 'John',
        lastName: 'Doe'
      },
    });

    expect(completeRes.status).toBe(200);
    expect(completeRes.json.success).toBe(true);
    
    const token = completeRes.json.data.token;
    expect(token).toBeDefined();

    // 4. Get profile
    const profileRes = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/auth/me',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(profileRes.status).toBe(200);
    expect(profileRes.json.data.user.email).toBe(email);

    // 5. Update profile
    const updateRes = await httpJson({
      baseUrl,
      method: 'PATCH',
      path: '/api/v1/profile',
      headers: { Authorization: `Bearer ${token}` },
      body: { firstName: 'Johnny' },
    });

    expect(updateRes.status).toBe(200);
    expect(updateRes.json.data.user.firstName).toBe('Johnny');
  }, 30000);

  it('handles forgot password + reset password', async () => {
    const email = 'local.user@example.com';
    const newPassword = 'NewPassword123';

    // 1. Forgot password
    const forgotRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/forgot-password',
      body: { email },
    });

    expect(forgotRes.status).toBe(200);

    // 2. Get code
    const lastEmail = sentEmails[sentEmails.length - 1];
    const code = extractSixDigitCode(lastEmail.html);
    expect(code).toHaveLength(6);

    // 3. Reset password
    const resetRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/reset-password',
      body: { email, token: code, newPassword },
    });

    expect(resetRes.status).toBe(200);

    // 4. Verify login
    const loginRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email, password: newPassword },
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.json.data.token).toBeDefined();
  }, 30000);

  it('signs up with Google id token', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/google/token',
      body: { idToken: 'fake-google-token' },
    });

    expect(res.status).toBe(200);
    expect(res.json.data.user.email).toBe('google.user@example.com');
  });

  it('signs up with TikTok', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/tiktok',
      body: { 
        code: 'fake-tiktok-code',
        redirectUri: 'http://localhost:3001/auth/tiktok/callback'
      },
    });

    expect(res.status).toBe(200);
    expect(res.json.data.user.email).toBe('tiktok_tk-open-id@tiktok.local');
  });
});
