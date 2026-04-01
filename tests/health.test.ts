import type { Server } from 'http';
import http from 'http';

/**
 * Mock DB and Redis clients BEFORE importing the app.
 * Using jest.mock at the top level ensures all app modules get the mocked versions.
 */
jest.mock('../src/db/client', () => ({
  ...jest.requireActual('../src/db/client'),
  getMongoStatus: () => 'connected',
}));

jest.mock('../src/cache/redis.client', () => ({
  ...jest.requireActual('../src/cache/redis.client'),
  getRedisStatus: () => 'ready',
}));

function httpJson(opts: {
  baseUrl: string;
  method: string;
  path: string;
}): Promise<{ status: number; text: string }> {
  const url = new URL(opts.path, opts.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, text: raw });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Health Endpoints', () => {
  jest.setTimeout(60000);
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Provide mandatory environment variables for validation
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
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.REDIS_URL = 'redis://localhost:6379'; // Dummy URL for validation
    process.env.METRICS_ENABLED = 'false';

    const { createApp } = await import('../src/app');
    const app = await createApp();
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
  });

  it('GET /health should return 200 OK', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/health',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('status');
  });

  it('GET /ready should return 200 OK', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/ready',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('status');
  });
});
