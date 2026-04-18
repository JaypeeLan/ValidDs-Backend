import Stripe from 'stripe';
import { env } from '../config/env.validation';

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
  stripeClient = new Stripe(key);
  return stripeClient;
}
