import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';
import { minimalTestProduct } from './helpers/minimal-product.fixture';
import { minimalTestCreative } from './helpers/minimal-creative.fixture';
import { getSeededTestMarketModels } from './helpers/market-test-models';

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
    process.env.NODE_ENV = 'test';
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
    const { Product, Creative } = await getSeededTestMarketModels();
    const { signJWT } = await import('../src/security/jwt');

    const testUser = await User.create({
      email: 'creative@example.com',
      name: 'Creative Tester',
      authProvider: 'local',
      status: 'active',
      plan: 'pro',
      contentRegion: 'US',
    });
    testToken = signJWT({ sub: (testUser._id as any).toString(), role: 'user' });

    const product = await Product.create(
      minimalTestProduct({
        title: 'Test Product',
        externalId: 'ext_1',
        source: 'tiktok',
      }),
    );
    productId = (product._id as any).toString();

    const creative = await Creative.create(
      minimalTestCreative({
        productId: product._id,
        externalVideoId: 'vid_1',
        section: 'top-ads',
        isAd: true,
        publishedAt: new Date('2020-01-01'),
        creator: {
          tiktokUserId: 'u1',
          handle: 'cre1',
          displayName: 'Creator One',
          region: 'US',
          tiktokPostUrl: 'https://www.tiktok.com/@cre1/video/1',
          isIndependentCreator: false,
        },
        metrics: {
          viewCount: 10000,
          likeCount: 1000,
        },
      }),
    );
    creativeId = (creative._id as any).toString();

    await Creative.create(
      minimalTestCreative({
        productId: product._id,
        externalVideoId: 'vid_2',
        section: 'trending',
        isAd: false,
        publishedAt: new Date('2024-01-01'),
        tiktokPostUrl: 'https://www.tiktok.com/@indie1/video/2',
        creator: {
          tiktokUserId: 'u2',
          handle: 'indie1',
          displayName: 'Indie Creator',
          region: 'GB',
          tiktokPostUrl: 'https://www.tiktok.com/@indie1/video/2',
          isIndependentCreator: true,
        },
        metrics: {
          viewCount: 500,
          likeCount: 50,
        },
      }),
    );

    await Creative.create(
      minimalTestCreative({
        productId: product._id,
        externalVideoId: 'vid_3',
        section: 'top-ads',
        isAd: true,
        publishedAt: new Date('2024-06-01'),
        creator: {
          tiktokUserId: 'u1b',
          handle: 'cre1',
          displayName: 'Creator One',
          region: 'US',
          tiktokPostUrl: 'https://www.tiktok.com/@cre1/video/3',
          isIndependentCreator: false,
        },
        metrics: {
          viewCount: 2000,
          likeCount: 200,
        },
      }),
    );
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (disconnectMongoFn) await disconnectMongoFn();
    if (mongo) await mongo.stop();
  });

  it('GET /api/v1/creatives should allow public discovery without token', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/creatives',
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.success).toBe(true);
  });

  it('GET /api/v1/creatives?groupBy=creator should return unique creators', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: `/api/v1/creatives?groupBy=creator&productId=${productId}`,
      token: testToken
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.success).toBe(true);
    expect(body.data.groupBy).toBe('creator');
    expect(body.data.pagination.total).toBe(2);
    const handles = body.data.data.map((c: { creator: { handle: string }; videoCount: number }) => ({
      handle: c.creator.handle,
      videoCount: c.videoCount,
    }));
    expect(handles).toEqual(
      expect.arrayContaining([
        { handle: 'cre1', videoCount: 2 },
        { handle: 'indie1', videoCount: 1 },
      ])
    );
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
    const ids = body.data.data.map((c: { externalVideoId: string }) => c.externalVideoId).sort();
    expect(ids).toEqual(['vid_1', 'vid_3']);
  });

  it('GET /api/v1/creatives/top-ads should return only independent-creator creatives', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/creatives/top-ads',
      token: testToken
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    expect(body.success).toBe(true);
    expect(body.data.data.length).toBe(1);
    expect(body.data.data[0].externalVideoId).toBe('vid_2');
    expect(body.data.data[0].creator.isIndependentCreator).toBe(true);
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

  it('GET /api/v1/creatives?section=trending should return DB top-ads bucket creatives', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/creatives?section=trending',
      token: testToken
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text);
    const ids = body.data.data.map((c: { externalVideoId: string }) => c.externalVideoId).sort();
    expect(ids).toEqual(['vid_1', 'vid_3']);
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
