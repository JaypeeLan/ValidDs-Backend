import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.validation';
import { UnauthorizedError } from './error.middleware';
import { logger } from '../logger';

const log = logger.child({ module: 'ingest-key' });

/** Scraper → backend ingest (`X-Ingest-Key` must match `SCRAPER_INGEST_KEY`). */
export function requireIngestKey(req: Request, _res: Response, next: NextFunction): void {
  const key = req.headers['x-ingest-key'];
  if (!key || typeof key !== 'string') {
    return next(new UnauthorizedError('Ingest key required'));
  }
  if (key !== env.SCRAPER_INGEST_KEY) {
    log.warn('Invalid ingest key attempt', { ip: req.ip });
    return next(new UnauthorizedError('Invalid ingest key'));
  }
  next();
}
