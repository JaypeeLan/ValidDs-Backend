import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Server } from 'http';
import http from 'http';

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
  let mongo: MongoMemoryServer;
  let server: Server;
  let baseUrl: string;
  let disconnectMongoFn: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    process.env.MONGODB_URI = mongo.getUri();

    jest.resetModules();
    const db = await import('../src/db/client');
    await db.connectMongo();
    disconnectMongoFn = db.disconnectMongo;

    const redis = await import('../src/cache/redis.client');
    jest.spyOn(redis, 'getRedisStatus').mockReturnValue('ready');

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
    if (disconnectMongoFn) await disconnectMongoFn();
    if (mongo) await mongo.stop();
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
