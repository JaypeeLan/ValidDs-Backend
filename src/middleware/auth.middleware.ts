import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.validation';
import { verifyJWT } from '../security/jwt';
import { User, UserRole } from '../models/user.model';
import { UnauthorizedError, ForbiddenError } from './error.middleware';
import { logger } from '../logger';
import { isSuperAdmin, userHasRole } from '../utils/roles.util';

const log = logger.child({ module: 'auth' });

/**
 * JWT authentication middleware.
 *
 * Reads from: Authorization: Bearer <token>
 * Verifies the token, then fetches the live user from the DB.
 * Attaches the full user document to req.user.
 *
 * Fetching from DB (not just trusting the token) ensures:
 *  - Suspended/deleted users are rejected immediately
 *  - Plan changes take effect without waiting for token expiry
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const token = authHeader.slice(7);
    const result = verifyJWT(token);

    if (!result.valid || !result.payload) {
      return next(
        new UnauthorizedError(
          result.expired ? 'Session expired — please sign in again' : 'Invalid token',
        ),
      );
    }

    const user = await User.findActiveById(result.payload.sub as string);
    if (!user) {
      return next(new UnauthorizedError('Account not found or suspended'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth middleware.
 * Attaches user to req if a valid token is present, but does NOT reject if missing.
 * Use on routes that have different behaviour for authenticated vs anonymous users.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) return next();

    const token = authHeader.slice(7);
    const result = verifyJWT(token);
    if (!result.valid || !result.payload) return next();

    const user = await User.findActiveById(result.payload.sub as string);
    if (user) req.user = user;
    next();
  } catch {
    next();
  }
}

/**
 * Role guard — use AFTER requireAuth.
 * Usage: router.delete('/users/:id', requireAuth, requireRole('admin'), controller)
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError('Authentication required'));
    if (!userHasRole(req.user.role as UserRole, ...roles)) {
      log.warn('Forbidden access attempt', {
        userId: req.user.id,
        requiredRoles: roles,
        userRole: req.user.role,
      });
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }
    next();
  };
}

/** Super admins only — use after requireAuth. */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new UnauthorizedError('Authentication required'));
  if (!isSuperAdmin(req.user.role as UserRole)) {
    return next(new ForbiddenError('Super admin access required'));
  }
  next();
}

/**
 * Internal API key authentication (service-to-service, ingestion jobs, admin scripts).
 */
export function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'];
  if (!key || typeof key !== 'string') {
    return next(new UnauthorizedError('API key required'));
  }
  if (key !== env.INTERNAL_API_KEY) {
    log.warn('Invalid API key attempt', { ip: req.ip });
    return next(new UnauthorizedError('Invalid API key'));
  }
  next();
}

// ── Global type augmentation ──────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: import('../models/user.model').IUserDocument;
    }
  }
}
