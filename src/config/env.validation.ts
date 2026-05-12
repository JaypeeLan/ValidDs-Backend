import { z } from 'zod';

/**
 * Validates all environment variables on app startup.
 * If any required variable is missing or malformed, the app crashes
 * immediately with a clear error — rather than failing silently later.
 */

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_NAME: z.string().default('validds-backend'),
  API_VERSION: z.string().default('v1'),

  // Security
  INTERNAL_API_KEY: z.string().min(32, 'API key must be at least 32 characters'),
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().length(64, 'Encryption key must be 32 bytes (64 hex chars)'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3001'),

  // MongoDB
  MONGODB_URI: z.string().url('MONGODB_URI must be a valid URI'),
  MONGODB_DB_NAME: z.string().default('validds'),

  // Redis
  REDIS_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1, 'REDIS_URL must not be empty').optional()
  ),

  // Sentry
  SENTRY_DSN: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url('SENTRY_DSN must be a valid URL').optional()
  ),
  SENTRY_ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // TikTok
  TIKTOK_API_KEY: z.string().optional(),
  TIKTOK_API_BASE_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional()
  ),
  TIKTOK_CLIENT_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  TIKTOK_CLIENT_SECRET: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // Resend (email)
  RESEND_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  RESEND_FROM: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),


  TIKTOK_REGION: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional().default('US')
  ),

  // AI Providers
  DEEPSEEK_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  GOOGLE_AI_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  GOOGLE_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  OPENAI_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // TeemDrop API
  TEEMDROP_APP_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  TEEMDROP_APP_SECRET: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  TEEMDROP_BASE_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional().default('https://openapi.teemdrop.com')
  ),
  TEEMDROP_USER_AGENT: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional().default('PostmanRuntime/7.43.0')
  ),

  // Frontend URL — used for OAuth redirects and Stripe checkout redirect URLs
  FRONTEND_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional().default('http://localhost:3001')
  ),

  // Stripe
  STRIPE_SECRET_KEY_TEST: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_SECRET_KEY_LIVE: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_PUBLISHABLE_KEY_TEST: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_PUBLISHABLE_KEY_LIVE: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_WEBHOOK_SECRET_TEST: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_WEBHOOK_SECRET_LIVE: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // Stripe Price IDs (test)
  STRIPE_PRICE_ID_EXPLORER_TEST: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_PRICE_ID_PRO_TEST: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_PRICE_ID_PREMIUM_TEST: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // Stripe Price IDs (live)
  STRIPE_PRICE_ID_EXPLORER_LIVE: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_PRICE_ID_PRO_LIVE: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  STRIPE_PRICE_ID_PREMIUM_LIVE: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // Shopify (OAuth — for "Connect Shopify store")
  SHOPIFY_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  SHOPIFY_API_SECRET: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  SHOPIFY_API_SCOPES: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional().default('read_products,write_products')
  ),
  SHOPIFY_API_VERSION: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional().default('2025-01')
  ),
  SHOPIFY_REDIRECT_URI: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional()
  ),
  SHOPIFY_SIGNUP_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional().default('https://www.shopify.com/signup')
  ),
  SHOPIFY_PARTNER_REFERRAL_CODE: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // ScrapeCreators
  SCRAPECREATORS_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  SCRAPECREATORS_BASE_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional().default('https://api.scrapecreators.com')
  ),

  // Apify
  APIFY_API_TOKEN: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  APIFY_SHOPIFY_MAX_ITEMS: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.coerce.number().int().positive().optional().default(20)
  ),
  APIFY_ACTOR_TIMEOUT_MS: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.coerce.number().int().positive().optional().default(30000)
  ),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),
  ENABLE_DEV_JOBS: z.coerce.boolean().default(false),

});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const isStaging = process.env.NODE_ENV === 'staging';

  const envToParse = { ...process.env };

  if (isStaging) {
    envToParse.INTERNAL_API_KEY = envToParse.INTERNAL_API_KEY || 'dummy_api_key_for_staging_environments_only!';
    envToParse.JWT_SECRET = envToParse.JWT_SECRET || 'dummy_jwt_secret_for_staging_environments_only!';
    envToParse.ENCRYPTION_KEY = envToParse.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    envToParse.MONGODB_URI = envToParse.MONGODB_URI || 'mongodb://localhost:27017/dummy_staging';
  }

  const result = envSchema.safeParse(envToParse);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ✗ ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    console.error('\n[ValidDs] Environment validation failed:\n' + formatted + '\n');
    console.error('See .env.example for required variables.\n');

    if (isStaging) {
      console.warn('[ValidDs] STAGING MODE: Bypassing environment validation crash.');
      return envToParse as unknown as Env;
    } else if (process.env.NODE_ENV === 'test') {
      console.warn('[ValidDs] TEST MODE: Bypassing environment validation crash.');
      return result.data || (envToParse as unknown as Env);
    } else {
      process.exit(1);
    }
  }

  return result.data;
}

export const env = validateEnv();
