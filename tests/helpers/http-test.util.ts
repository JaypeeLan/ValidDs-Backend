import http from 'http';

export interface HttpResult {
  status: number;
  text: string;
  headers: http.IncomingHttpHeaders;
}

/** Hit the real Express app (no mocks). */
export function httpRequest(opts: {
  baseUrl: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}): Promise<HttpResult> {
  const url = new URL(opts.path, opts.baseUrl);
  return new Promise((resolve, reject) => {
    const payload = opts.body;
    const req = http.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          ...(payload
            ? {
                'Content-Type': payload instanceof Buffer ? 'application/json' : 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export function assertAllowedStatus(label: string, result: HttpResult, allowed: number[]): void {
  if (!allowed.includes(result.status)) {
    throw new Error(
      `${label}: expected one of [${allowed.join(', ')}] but got ${result.status}\n${result.text.slice(0, 500)}`,
    );
  }
}
