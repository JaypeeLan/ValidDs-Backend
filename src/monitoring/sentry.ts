import * as Sentry from '@sentry/node';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'sentry' });

/**
 * Sentry error tracking.
 *
 * Initialise once at startup (called in server.ts BEFORE anything else).
 * After init, unhandled exceptions and promise rejections are captured automatically.
 *
 * Manual usage:
 *   import { captureError, captureMessage } from '../monitoring/sentry';
 *   captureError(err, { userId, route });
 *
 * See docs/third-party/sentry.md for setup instructions.
 */

let initialised = false;

export function initialiseSentry(): void {
  if (env.NODE_ENV === 'development') {
    log.info('Sentry tracking disabled in development mode');
    return;
  }

  if (!env.SENTRY_DSN) {
    log.warn('SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
    ],
    beforeSend(event) {
      // Strip sensitive headers before sending to Sentry
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['x-api-key'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });

  initialised = true;
  log.info('Sentry initialised', { environment: env.SENTRY_ENVIRONMENT });
}

export function captureError(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (!initialised) return;

  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    if (err instanceof Error) {
      Sentry.captureException(err);
    } else {
      Sentry.captureMessage(String(err), 'error');
    }
  });
}

export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info'
): void {
  if (!initialised) return;
  Sentry.captureMessage(message, level);
}

// Re-export Sentry request handler for Express (used in app.ts)
export { Sentry };
