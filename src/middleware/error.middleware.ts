import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { env } from '../config/env.validation';

const log = logger.child({ module: 'error-handler' });

/**
 * Base application error class.
 * Throw this (or a subclass) anywhere in the app to produce
 * a clean, structured HTTP error response.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super(400, 'Validation failed', 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super(429, 'Too many requests', 'RATE_LIMITED');
    this.name = 'RateLimitError';
  }
}

/**
 * Global Express error handler.
 * Must be the LAST middleware registered in app.ts.
 *
 * Catches all errors thrown from routes, controllers, and services.
 * Returns a consistent JSON error shape to clients.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error(err.message, err);
    } else {
      log.warn(err.message, { code: err.code, statusCode: err.statusCode });
    }

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code ?? 'ERROR',
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        // Only expose stack in development
        ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
      },
    });
    return;
  }

  // Unknown/unhandled errors
  log.error('Unhandled error', err);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(env.NODE_ENV === 'development' && err instanceof Error
        ? { stack: err.stack }
        : {}),
    },
  });
}

/**
 * 404 handler — register this AFTER all routes, BEFORE the error handler.
 */
export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}
