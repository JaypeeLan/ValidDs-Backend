import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';

import { env } from './config/env.validation';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware';
import { sanitizeMiddleware } from './middleware/sanitize.middleware';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';
import { getAllowedOrigins } from './security/encryption';
import { healthRouter } from './api/index';
import apiRouter from './api/index';
import { Sentry } from './monitoring/sentry';
import { metricsMiddleware } from './middleware/metrics.middleware';
import swaggerUi from 'swagger-ui-express';
import { getSwaggerSpec } from './docs/swagger.provider';
import { handleStripeWebhook } from './api/webhooks/stripe.webhook.controller';

/**
 * Creates and configures the Express application.
 *
 * Middleware is applied in this order (order matters):
 *  1. Sentry request handler          — must be first
 *  2. Helmet                          — security headers
 *  3. CORS                            — origin whitelist
 *  4. Stripe webhook (raw JSON body) — must run before express.json
 *  5. Body parsers                    — JSON + URL-encoded
 *  6. Request logger + context seed   — assigns requestId, starts AsyncLocalStorage
 *  7. Sanitizer                       — strips MongoDB operators + XSS from inputs
 *  8. Routes                          — health + API
 *  9. 404 handler                     — catches unmatched routes
 * 10. Sentry error handler            — forwards errors to Sentry
 * 11. Global error handler            — formats error responses (must be last)
 */
export async function createApp(): Promise<Application> {
  const app = express();

  // ── 1. Sentry request handler ─────────────────────────────────────────────
  if (env.NODE_ENV !== 'development') {
    app.use(Sentry.Handlers.requestHandler());
  }

  // ── 1.5 Prometheus Metrics Middleware ─────────────────────────────────────
  if (env.METRICS_ENABLED && env.NODE_ENV !== 'development') {
    app.use(metricsMiddleware);
  }

  // ── 2. Helmet — security headers ─────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://validator.swagger.io'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: true,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: {
        maxAge: 31536000,      // 1 year
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      frameguard: { action: 'deny' },
      xssFilter: true,
    })
  );

  // ── 3. CORS ───────────────────────────────────────────────────────────────
  const allowedOrigins = getAllowedOrigins();
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. server-to-server, Postman in dev)
        if (!origin || env.NODE_ENV === 'development') {
          return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining'],
      credentials: true,
      maxAge: 86400, // Cache preflight for 24 hours
    })
  );

  // ── 4. Stripe webhook (raw body required for signature verification) ──────
  app.post(
    `/api/${env.API_VERSION}/webhooks/stripe`,
    express.raw({ type: 'application/json' }),
    handleStripeWebhook
  );

  // ── 5. Body parsers ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── 6. Request logger + context ───────────────────────────────────────────
  app.use(requestLoggerMiddleware);

  // ── 7. Sanitizer ──────────────────────────────────────────────────────────
  app.use(sanitizeMiddleware);

  // ── 7.5 Swagger Documentation ─────────────────────────────────────────────
  const swaggerSpec = await getSwaggerSpec();
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'ValidDs API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      filter: true,
      displayRequestDuration: true,
    },
  }));

  // ── 8. Routes ─────────────────────────────────────────────────────────────
  // Health checks at root level (not versioned — required by Render health check config)
  app.use('/', healthRouter);

  // All API routes under /api/v1
  app.use(`/api/${env.API_VERSION}`, apiRouter);

  // ── 9. [Removed manual Prometheus hook] ──────────────────────────────────

  // ── 9. 404 ───────────────────────────────────────────────────────────────
  app.use(notFoundMiddleware);

  // ── 10. Sentry error handler ──────────────────────────────────────────────
  if (env.NODE_ENV !== 'development') {
    app.use(Sentry.Handlers.errorHandler());
  }

  // ── 11. Global error handler (must be last) ───────────────────────────────
  app.use(errorMiddleware);

  return app;
}
