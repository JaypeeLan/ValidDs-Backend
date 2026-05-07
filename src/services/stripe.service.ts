import Stripe from 'stripe';
import { env } from '../config/env.validation';
import { UserPlan } from '../models/user.model';

type StripeClient = InstanceType<typeof Stripe>;

let stripeClient: StripeClient | null = null;
let stripeClientKey: string | undefined;

/**
 * Live Stripe keys are used only in production. All other NODE_ENV values use *_TEST keys.
 */
export function isStripeLiveMode(): boolean {
  return env.NODE_ENV === 'production';
}

export function getStripeSecretKey(): string | undefined {
  return isStripeLiveMode() ? env.STRIPE_SECRET_KEY_LIVE : env.STRIPE_SECRET_KEY_TEST;
}

export function getStripePublishableKey(): string | undefined {
  return isStripeLiveMode() ? env.STRIPE_PUBLISHABLE_KEY_LIVE : env.STRIPE_PUBLISHABLE_KEY_TEST;
}

export function getStripeWebhookSecret(): string | undefined {
  return isStripeLiveMode() ? env.STRIPE_WEBHOOK_SECRET_LIVE : env.STRIPE_WEBHOOK_SECRET_TEST;
}

/**
 * Shared Stripe SDK client (test or live secret, depending on NODE_ENV).
 * Returns null when the corresponding secret key is not configured.
 */
export function getStripe(): StripeClient | null {
  const key = getStripeSecretKey();
  if (!key) return null;
  if (stripeClient && stripeClientKey === key) return stripeClient;
  stripeClientKey = key;
  stripeClient = new Stripe(key, { apiVersion: '2024-06-20' });
  return stripeClient;
}

// ── Plan → Price ID mapping ───────────────────────────────────────────────────

// Paid plans only — 'free' has no price ID. All are recurring subscriptions.
const PRICE_MAP_TEST: Partial<Record<UserPlan, string | undefined>> = {
  explorer: env.STRIPE_PRICE_ID_EXPLORER_TEST,
  pro:      env.STRIPE_PRICE_ID_PRO_TEST,
  premium:  env.STRIPE_PRICE_ID_PREMIUM_TEST,
};

const PRICE_MAP_LIVE: Partial<Record<UserPlan, string | undefined>> = {
  explorer: env.STRIPE_PRICE_ID_EXPLORER_LIVE,
  pro:      env.STRIPE_PRICE_ID_PRO_LIVE,
  premium:  env.STRIPE_PRICE_ID_PREMIUM_LIVE,
};

/**
 * Returns the Stripe Price ID for a given plan, based on current mode (test/live).
 * Returns undefined if the plan is not a paid plan or the env var is not set.
 */
export function getPriceIdForPlan(plan: UserPlan): string | undefined {
  const map = isStripeLiveMode() ? PRICE_MAP_LIVE : PRICE_MAP_TEST;
  return map[plan];
}

/**
 * Free trial duration applied to every new paid subscription.
 * Users enter payment details at checkout but are not charged until the trial ends.
 */
export const STRIPE_TRIAL_DAYS = 7;
