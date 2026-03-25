import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

function extractSixDigitCode(html: string): string | null {
  const match = html.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

function extractHexToken(html: string): string | null {
  const match = html.match(/\b([a-f0-9]{64})\b/i);
  return match ? match[1] : null;
}

function createMockResponse(input: { ok: boolean; status: number; json?: any; text?: string }) {
  return {
    ok: input.ok,
    status: input.status,
    async json() {
      return input.json;
    },
    async text() {
      return input.text ?? JSON.stringify(input.json ?? {});
    },
  } as any;
}

async function httpJson(opts: {
  baseUrl: string;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{ status: number; json: JsonValue; raw: string }> {
  const url = new URL(opts.path, opts.baseUrl);
  const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));

  const headers: Record<string, string> = {
    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
    ...(opts.headers ?? {}),
  };

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            const json = raw ? (JSON.parse(raw) as JsonValue) : (null as JsonValue);
            resolve({ status: res.statusCode ?? 0, json, raw });
          } catch {
            reject(new Error(`Invalid JSON response (status=${res.statusCode ?? 0}): ${raw}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('Auth + Profile', () => {
  let mongo: MongoMemoryServer;
  let server: Server;
  let baseUrl: string;
  const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
  let disconnectMongoFn: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '0';
    process.env.APP_NAME = 'validds-backend-test';
    process.env.API_VERSION = 'v1';
    process.env.INTERNAL_API_KEY = 'k'.repeat(32);
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.JWT_EXPIRES_IN = '7d';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3001';
    process.env.MONGODB_DB_NAME = 'validds_test';
    process.env.REDIS_URL = '';
    process.env.SENTRY_DSN = '';
    process.env.SENTRY_ENVIRONMENT = 'development';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0';
    process.env.METRICS_ENABLED = 'false';
    process.env.METRICS_PORT = '0';
    process.env.LOG_LEVEL = 'error';
    process.env.LOG_PRETTY = 'false';
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM = 'ValidDs <noreply@validds.test>';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.TIKTOK_CLIENT_KEY = 'tiktok-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'tiktok-client-secret';

    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    process.env.MONGODB_URI = mongo.getUri();

    const realFetch = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url;

      if (url === 'https://api.resend.com/emails') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        sentEmails.push({
          to: String(body.to ?? ''),
          subject: String(body.subject ?? ''),
          html: String(body.html ?? ''),
        });
        return createMockResponse({ ok: true, status: 200, json: { id: 'email_123' } });
      }

      if (String(url).startsWith('https://oauth2.googleapis.com/tokeninfo')) {
        return createMockResponse({
          ok: true,
          status: 200,
          json: {
            aud: process.env.GOOGLE_CLIENT_ID,
            sub: 'google-sub-1',
            email: 'google.user@example.com',
            name: 'Google User',
            given_name: 'Google',
            family_name: 'User',
            picture: 'https://example.com/avatar.png',
          },
        });
      }

      if (url === 'https://open.tiktokapis.com/v2/oauth/token/') {
        return createMockResponse({
          ok: true,
          status: 200,
          json: {
            access_token: 'tiktok-access',
            open_id: 'tiktok-open-1',
          },
        });
      }

      if (String(url).startsWith('https://open.tiktokapis.com/v2/user/info/')) {
        return createMockResponse({
          ok: true,
          status: 200,
          json: {
            data: {
              user: {
                open_id: 'tiktok-open-1',
                union_id: 'tiktok-union-1',
                display_name: 'TikTok User',
                avatar_url: 'https://example.com/tiktok.png',
              },
            },
          },
        });
      }

      return realFetch(input, init);
    }) as any;

    jest.resetModules();
    const { connectMongo, disconnectMongo } = await import('../src/db/client');
    await connectMongo();
    disconnectMongoFn = disconnectMongo;

    const { createApp } = await import('../src/app');
    const app = createApp();
    server = app.listen(0);

    await new Promise<void>((resolve) => {
      server.on('listening', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (disconnectMongoFn) {
      await disconnectMongoFn();
    }
    if (mongo) {
      await mongo.stop();
    }
  });

  it('registers, sends + verifies email code, and fetches/updates profile', async () => {
    const email = 'local.user@example.com';
    const password = 'Password1';

    const registerRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/register',
      body: { email },
    });

    expect(registerRes.status).toBe(200);
    expect((registerRes.json as any).success).toBe(true);
    expect((registerRes.json as any).data.sent).toBe(true);

    const lastEmail = sentEmails[sentEmails.length - 1];
    const verificationCode = lastEmail ? extractSixDigitCode(lastEmail.html) : null;
    expect(verificationCode).not.toBeNull();

    const verifyRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/email/verify-code',
      body: { email, code: verificationCode, password, name: 'Local User' },
    });
    expect(verifyRes.status).toBe(200);
    expect((verifyRes.json as any).success).toBe(true);
    expect((verifyRes.json as any).data.user.email).toBe(email);
    const token = (verifyRes.json as any).data.token as string;
    expect(typeof token).toBe('string');

    const sendCodeRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/email/send-code',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sendCodeRes.status).toBe(200);
    expect((sendCodeRes.json as any).success).toBe(true);
    expect((sendCodeRes.json as any).data.sent).toBe(true);

    const meRes = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/profile',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    expect((meRes.json as any).success).toBe(true);
    expect((meRes.json as any).data.user.email).toBe(email);

    const updateRes = await httpJson({
      baseUrl,
      method: 'PATCH',
      path: '/api/v1/profile',
      headers: { Authorization: `Bearer ${token}` },
      body: { timezone: 'Africa/Lagos', locale: 'en-NG' },
    });
    expect(updateRes.status).toBe(200);
    expect((updateRes.json as any).success).toBe(true);
    expect((updateRes.json as any).data.user.timezone).toBe('Africa/Lagos');
    expect((updateRes.json as any).data.user.locale).toBe('en-NG');
  });

  it('handles forgot password + reset password', async () => {
    const email = 'reset.user@example.com';
    const originalPassword = 'Password1';
    const newPassword = 'NewPassword1';

    const registerRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/register',
      body: { email },
    });
    expect(registerRes.status).toBe(200);

    const lastEmail = sentEmails[sentEmails.length - 1];
    const verificationCode = lastEmail ? extractSixDigitCode(lastEmail.html) : null;
    expect(verificationCode).not.toBeNull();

    const verifyRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/email/verify-code',
      body: { email, code: verificationCode, password: originalPassword, name: 'Reset User' },
    });
    expect(verifyRes.status).toBe(200);

    const forgotRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/forgot-password',
      body: { email },
    });
    expect(forgotRes.status).toBe(200);
    expect((forgotRes.json as any).success).toBe(true);

    const resetEmail = sentEmails
      .slice()
      .reverse()
      .find((e) => e.to === email && e.subject.toLowerCase().includes('reset'));
    const resetToken = resetEmail ? extractHexToken(resetEmail.html) : null;
    expect(resetToken).not.toBeNull();

    const resetRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/reset-password',
      body: { email, token: resetToken, newPassword },
    });
    expect(resetRes.status).toBe(200);
    expect((resetRes.json as any).success).toBe(true);

    const loginRes = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email, password: newPassword },
    });
    expect(loginRes.status).toBe(200);
    expect((loginRes.json as any).success).toBe(true);
    expect(typeof (loginRes.json as any).data.token).toBe('string');
  });

  it('signs up with Google id token', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/google/token',
      body: { idToken: 'fake-id-token' },
    });

    expect(res.status).toBe(200);
    expect((res.json as any).success).toBe(true);
    expect((res.json as any).data.user.email).toBe('google.user@example.com');
    expect(typeof (res.json as any).data.token).toBe('string');
  });

  it('signs up with TikTok', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'POST',
      path: '/api/v1/auth/tiktok',
      body: { code: 'fake-code', redirectUri: 'http://localhost/callback' },
    });

    expect(res.status).toBe(200);
    expect((res.json as any).success).toBe(true);
    expect(String((res.json as any).data.user.email)).toContain('@tiktok.local');
    expect(typeof (res.json as any).data.token).toBe('string');
  });
});
