import { z } from 'zod';

/**
 * Validates all environment variables on app startup.
 * If any required variable is missing or malformed, the app crashes
 * immediately with a clear error — rather than failing silently later.
 */

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
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

  // RapidAPI (Creative Center fallback)
  RAPIDAPI_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  RAPIDAPI_HOST: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  RAPIDAPI_BASE_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional()
  ),
  RAPIDAPI_TOP_ADS_PATH: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  RAPIDAPI_TRENDING_HASHTAGS_PATH: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  RAPIDAPI_TRENDING_VIDEOS_PATH: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  RAPIDAPI_KEYWORD_TRENDS_PATH: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  TIKTOK_MS_TOKEN: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  CREATIVE_CENTER_REGION: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // AI Providers
  DEEPSEEK_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  ANTHROPIC_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),
  OPENAI_API_KEY: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().min(1).optional()
  ),

  // Fallbacks
  FALLBACK_A_API_KEY: z.string().optional(),
  FALLBACK_A_BASE_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional()
  ),
  FALLBACK_B_API_KEY: z.string().optional(),
  FALLBACK_B_BASE_URL: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().url().optional()
  ),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  // Metrics
  METRICS_ENABLED: z.coerce.boolean().default(true),
  METRICS_PORT: z.coerce.number().default(9090),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ✗ ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    console.error('\n[ValidDs] Environment validation failed:\n' + formatted + '\n');
    console.error('See .env.example for required variables.\n');
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
