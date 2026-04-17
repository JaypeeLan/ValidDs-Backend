import { Request, Response, NextFunction } from 'express';
import sanitize = require('mongo-sanitize');

/**
 * Input sanitization middleware.
 *
 * Two layers of protection:
 *
 * 1. MongoDB injection — strips keys starting with '$' or containing '.'
 *    from req.body, req.params, and req.query.
 *    Prevents attackers injecting MongoDB operators into queries.
 *
 * 2. Basic XSS — strips <script> tags and event handlers from string fields.
 *    This is a lightweight in-transit sanitizer. For stored content that will
 *    be rendered in a browser, sanitize again at render time (DOMPurify etc).
 */

export function sanitizeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.body) {
    req.body = sanitize(req.body);
    req.body = deepSanitizeStrings(req.body);
  }
  if (req.params) {
    req.params = deepSanitizeStrings(sanitize(req.params));
  }
  if (req.query) {
    req.query = deepSanitizeStrings(sanitize(req.query)) as any;
  }

  next();
}

function deepSanitizeStrings(value: unknown): any {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepSanitizeStrings(item));
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      output[key] = deepSanitizeStrings(val);
    }
    return output;
  }

  return value;
}

function sanitizeString(raw: string): string {
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}
