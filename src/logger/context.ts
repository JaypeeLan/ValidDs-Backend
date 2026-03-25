import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request-scoped logging context using AsyncLocalStorage.
 *
 * This allows any log call within a request's async chain to automatically
 * include requestId, userId, and route — without passing them manually
 * through every function.
 *
 * Usage:
 *   // In middleware (called once per request):
 *   loggerContext.run({ requestId, route }, () => next());
 *
 *   // Anywhere inside that request's handlers:
 *   logger.info('product fetched');  // ← automatically includes requestId + route
 */

export interface LogContext {
  requestId?: string;
  userId?: string;
  route?: string;
}

export const loggerContext = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext {
  return loggerContext.getStore() ?? {};
}
