import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { loggerContext } from '../logger/context';
import { logger } from '../logger';

const log = logger.child({ module: 'request-logger' });

/**
 * Request logger middleware.
 *
 * - Assigns a unique requestId to every incoming request
 * - Seeds AsyncLocalStorage so all downstream logs carry requestId + route
 * - Logs request start and response finish with timing
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = uuidv4();
  const route = `${req.method} ${req.path}`;
  const startTime = Date.now();

  // Expose requestId on response headers for debugging
  res.setHeader('X-Request-Id', requestId);

  // Seed the async context — all logs within this request will auto-include requestId + route
  loggerContext.run({ requestId, route }, () => {
    log.info('Request received', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      log[level]('Request completed', {
        statusCode: res.statusCode,
        durationMs,
      });
    });

    next();
  });
}
