import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';

function httpJson(opts: {
  baseUrl: string;
  method: string;
  path: string;
  token?: string;
}): Promise<{ status: number; text: string }> {
  const url = new URL(opts.path, opts.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {}),
        },
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

describe('Creatives Endpoints', () => {
  jest.setTimeout(60000);
  let mongo: MongoMemoryServer;
  let server: Server;
  let baseUrl: string;
  let testToken: string;
  let productId: string;
  let creativeId: string;
  let disconnectMongoFn: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.INTERNAL_API_KEY = 'k'.repeat(32);
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.MONGODB_DB_NAME = 'validds_test';
    process.env.LOG_LEVEL = 'error';

    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    process.env.MONGODB_URI = mongo.getUri();

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

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Seed data
    const { User } = await import('../src/models/user.model');
    const { Product } = await import('../src/models/product.model');
    const { Creative } = await import('../src/models/creative.model');
    const { signJWT } = await import('../src/security/jwt');

    const testUser = await User.create({
      email: 'creative@example.com',
      name: 'Creative Tester',
      authProvider: 'local',
      status: 'active',
      plan: 'pro',
    });
    testToken = signJWT({ sub: (testUser._id as any).toString(), role: 'user' });

    const product = await Product.create({
      title: 'Test Product',
      externalId: 'ext_1',
      source: 'ensemble'
    });
    productId = (product._id as any).toString();

    const creative = await Creative.create({
      productId: product._id,
      externalVideoId: 'vid_1',
      section: 'top-ads',
      isAd: true,
      publishedAt: new Date(),
      creator: {
        handle: 'cre1',
        displayName: 'Creator One',
        region: 'US'
      },
      metrics: {
        viewCount: 10000,
        likeCount: 1000
      }
    });
    creativeId = (creative._id as any).toString();
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (disconnectMongoFn) await disconnectMongoFn();
    if (mongo) await mongo.stop();
  });

  it('GET /api/v1/creatives should return 401 without token', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/creatives',
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/creatives should return list with valid token', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/creatives',
      token: testToken
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.success).toBe(true);
    expect(body.data.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.data[0].externalVideoId).toBe('vid_1');
  });

  it('GET /api/v1/creatives?section=top-ads should work', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/creatives?section=top-ads',
      token: testToken
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.data.data[0].section).toBe('top-ads');
  });

  it('GET /api/v1/creatives?section=trending should return empty if none match', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/creatives?section=trending',
      token: testToken
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.data.data.length).toBe(0);
  });

  it('GET /api/v1/creatives/:id should return detail', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: `/api/v1/creatives/${creativeId}`,
      token: testToken
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.data.creative.externalVideoId).toBe('vid_1');
  });

  it('GET /api/v1/creatives/:id should return 404 for missing', async () => {
    const fakeId = creativeId.replace(/./, creativeId[0] === '0' ? '1' : '0'); 
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: `/api/v1/creatives/${fakeId}`,
      token: testToken
    });
    expect(res.status).toBe(404);
  });
});
