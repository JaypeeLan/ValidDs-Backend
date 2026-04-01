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

describe('Products Endpoints', () => {
  let mongo: MongoMemoryServer;
  let server: Server;
  let baseUrl: string;
  let disconnectMongoFn: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '0';
    process.env.API_VERSION = 'v1';

    mongo = await MongoMemoryServer.create();
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

  it('GET /api/v1/products should return product feed', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products?limit=10',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('data');
  });

  it('GET /api/v1/products/search should perform search', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products/search?q=test',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('data');
  });

  it('GET /api/v1/products/:id should return 400 for invalid ID format', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/api/v1/products/invalid_id',
    });
    expect(res.status).toBe(400); // Because 'invalid_id' is not a valid Mongo ObjectId
  });
});
