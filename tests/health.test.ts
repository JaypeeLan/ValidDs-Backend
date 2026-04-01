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
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.PORT = '0';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test'; // Mock URI, not actually used for health
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

  it('GET / should return 200 OK', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('status');
  });

  it('GET /healthz should return 200 OK', async () => {
    const res = await httpJson({
      baseUrl,
      method: 'GET',
      path: '/healthz',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('status');
  });
});
