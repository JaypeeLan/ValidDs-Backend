import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';

import { env } from './config/env.validation';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware';
import { sanitizeMiddleware } from './middleware/sanitize.middleware';
import { globalLimiter } from './middleware/rate-limit.middleware';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';
import { getAllowedOrigins } from './security/encryption';
import { healthRouter } from './api/index';
import apiRouter from './api/index';
import internalRouter from './api/internal/internal.routes';
import { Sentry } from './monitoring/sentry';
import swaggerUi from 'swagger-ui-express';
import { getAdminSwaggerSpec, getSwaggerSpec } from './docs/swagger.provider';
import { handleStripeWebhook } from './api/webhooks/stripe.webhook.controller';
import { handleShopifyWebhook } from './api/webhooks/shopify.webhook.controller';
import { StoreController } from './api/stores/store.controller';

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

  // Trust one hop of proxy headers (Render / nginx sit in front).
  // This makes req.ip resolve to the real client IP from X-Forwarded-For
  // instead of the load-balancer's address, which is required for correct
  // per-IP rate limiting.
  app.set('trust proxy', 1);

  // ── 1. Sentry request handler ─────────────────────────────────────────────
  if (env.NODE_ENV !== 'development') {
    app.use(Sentry.Handlers.requestHandler());
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
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      frameguard: { action: 'deny' },
      xssFilter: true,
    }),
  );

  // ── 3. CORS ───────────────────────────────────────────────────────────────
  const allowedOrigins = getAllowedOrigins();
  const corsMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
  // Per-request wrapper so we can allow same-host browser calls (Swagger UI at /docs).
  app.use((req, res, next) => {
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (curl, Postman, server-to-server)
        if (!origin || env.NODE_ENV === 'development') {
          return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Swagger UI at /docs sends Origin matching this API host.
        const host = req.headers['x-forwarded-host'] ?? req.headers.host;
        const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
        if (host && origin === `${proto}://${host}`) {
          return callback(null, true);
        }
        // Reject without throwing — Error() becomes a 500 in the global handler.
        callback(null, false);
      },
      methods: [...corsMethods],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Api-Key',
        'X-Ingest-Key',
        'X-Request-Id',
      ],
      exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining'],
      credentials: true,
      maxAge: 86400, // Cache preflight for 24 hours
    })(req, res, next);
  });

  // ── 4. Webhooks (raw body required for signature verification) ────────────
  app.post(
    `/api/${env.API_VERSION}/webhooks/stripe`,
    express.raw({ type: 'application/json' }),
    handleStripeWebhook,
  );
  app.post(
    `/api/${env.API_VERSION}/webhooks/shopify`,
    express.raw({ type: 'application/json' }),
    handleShopifyWebhook,
  );

  // ── 5. Body parsers ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── 6. Request logger + context ───────────────────────────────────────────
  app.use(requestLoggerMiddleware);

  // ── 7. Sanitizer ──────────────────────────────────────────────────────────
  app.use(sanitizeMiddleware);

  // ── 7.5 Global rate limiter ───────────────────────────────────────────────
  app.use(globalLimiter);

  // ── 7.7 Swagger Documentation ─────────────────────────────────────────────
  // Use `serveFiles` (not shared `serve`) so each mount gets its own swagger-ui-init.js;
  // otherwise the global init script is overwritten and /docs shows the last-registered spec (admin).
  const [swaggerSpec, adminSwaggerSpec] = await Promise.all([
    getSwaggerSpec(),
    getAdminSwaggerSpec(),
  ]);
  const docsSwaggerUiOpts = {
    customSiteTitle: 'ValidDs API — /docs',
    swaggerOptions: {
      persistAuthorization: true,
      filter: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  };
  const adminSwaggerUiOpts = {
    customSiteTitle: 'ValidDs Admin & Ops — /admin-docs',
    swaggerOptions: {
      persistAuthorization: true,
      filter: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  };
  app.use(
    '/docs',
    swaggerUi.serveFiles(swaggerSpec, docsSwaggerUiOpts),
    swaggerUi.setup(swaggerSpec, docsSwaggerUiOpts),
  );
  app.use(
    '/admin-docs',
    swaggerUi.serveFiles(adminSwaggerSpec, adminSwaggerUiOpts),
    swaggerUi.setup(adminSwaggerSpec, adminSwaggerUiOpts),
  );

  // ── 8. Routes ─────────────────────────────────────────────────────────────
  // Partner App URL — set in Shopify Partners → Configuration → App URL
  app.get('/shopify/app', StoreController.appEntry);
  app.get('/shopify/connected', StoreController.installConnected);

  // Serve local products export used by internal frontend tooling.
  app.get('/products.json', async (_req, res, next) => {
    try {
      const filePath = path.resolve(process.cwd(), 'products.json');
      const body = await fs.readFile(filePath, 'utf8');
      res.type('application/json').send(body);
    } catch (err) {
      next(err);
    }
  });

  // Health checks at root level (not versioned — required by Render health check config)
  app.use('/', healthRouter);

  // Scraper ingest (service-to-service, not versioned)
  app.use('/internal', internalRouter);

  // All API routes under /api/v1
  app.use(`/api/${env.API_VERSION}`, apiRouter);

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
