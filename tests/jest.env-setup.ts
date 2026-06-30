/**
 * Runs before test files load (see jest.config.ts setupFiles).
 * Ensures env.validation does not process.exit during integration tests.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT ?? '0';
process.env.APP_NAME = process.env.APP_NAME ?? 'validds-backend-test';
process.env.API_VERSION = process.env.API_VERSION ?? 'v1';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? 'k'.repeat(32);
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'x'.repeat(32);
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3001';
process.env.MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? 'validds_test';
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/validds_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? '';
process.env.SENTRY_DSN = process.env.SENTRY_DSN ?? '';
process.env.SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? 'development';
process.env.SENTRY_TRACES_SAMPLE_RATE = process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
process.env.LOG_PRETTY = process.env.LOG_PRETTY ?? 'false';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? 're_test';
process.env.RESEND_FROM = process.env.RESEND_FROM ?? 'ValidDs <noreply@validds.test>';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'google-client-id';
process.env.TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY ?? 'tiktok-client-key';
process.env.TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET ?? 'tiktok-client-secret';
process.env.SCRAPER_INGEST_KEY = process.env.SCRAPER_INGEST_KEY ?? 'change-me-scraper-ingest-key';
