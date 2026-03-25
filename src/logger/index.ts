import { env } from '../config/env.validation';
import { Logger } from './logger';

/**
 * Singleton logger instance used throughout the app.
 *
 * Import this everywhere:
 *   import { logger } from '../logger';
 *
 * For module-specific logging with auto-tagged context:
 *   const log = logger.child({ module: 'product-service' });
 */
export const logger = new Logger({
  level: env.LOG_LEVEL,
  pretty: env.LOG_PRETTY,
});

export { Logger } from './logger';
export { loggerContext } from './context';
export type { LogLevel } from './levels';
