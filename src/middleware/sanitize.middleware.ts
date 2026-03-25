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
  if (req.body) req.body = sanitize(req.body);
  if (req.params) req.params = sanitize(req.params);
  if (req.query) req.query = sanitize(req.query) as any;

  // Basic XSS strip on string body fields
  if (req.body && typeof req.body === 'object') {
    stripXSS(req.body);
  }

  next();
}

function stripXSS(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = val
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/on\w+='[^']*'/gi, '');
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      stripXSS(val as Record<string, unknown>);
    }
  }
}
