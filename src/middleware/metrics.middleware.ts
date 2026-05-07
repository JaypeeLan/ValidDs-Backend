import { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDurationMs } from '../monitoring/metrics';

/**
 * Normalizes the path to reduce cardinality in Prometheus.
 * For example: /api/v1/products/65f123456789012345678901 -> /api/v1/products/:id
 */
function normalizePath(path: string): string {
  // Simple regex for MongoDB BSON IDs (24 hex characters)
  const bsonIdRegex = /[a-f\d]{24}/i;
  // Simple regex for numeric IDs
  const numericIdRegex = /\/\d+/g;

  let normalized = path;
  
  if (bsonIdRegex.test(normalized)) {
    normalized = normalized.replace(bsonIdRegex, ':id');
  } else {
    normalized = normalized.replace(numericIdRegex, '/:id');
  }

  // Remove trailing slashes (optional, but consistent)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Middleware to collect HTTP metrics (count and duration).
 * Uses the response 'finish' event to record metrics after the response is sent.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime();
  const path = normalizePath(req.baseUrl + req.path);

  res.on('finish', () => {
    const duration = process.hrtime(start);
    const durationMs = (duration[0] * 1000) + (duration[1] / 1e6);
    
    const labels = {
      method: req.method,
      route: path || '/',
      status_code: res.statusCode.toString(),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationMs.observe(labels, durationMs);
  });

  next();
}
