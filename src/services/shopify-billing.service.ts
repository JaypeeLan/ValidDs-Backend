import { env } from '../config/env.validation';
import { AppError } from '../middleware/error.middleware';
import { User, UserPlan } from '../models/user.model';
import { logger } from '../logger';
import { ShopifyService } from './shopify.service';

const log = logger.child({ module: 'shopify-billing' });

const PAID_PLANS: UserPlan[] = ['explorer', 'pro', 'premium'];

const PLAN_DISPLAY: Record<UserPlan, string> = {
  free: 'ValidDs Free',
  explorer: 'ValidDs Explorer',
  pro: 'ValidDs Pro',
  premium: 'ValidDs Premium',
};

export type ShopifyAppSubscriptionStatus =
  | 'ACTIVE'
  | 'PENDING'
  | 'CANCELLED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'FROZEN'
  | string;

export interface ShopifyAppSubscriptionRow {
  id: string;
  name: string;
  status: ShopifyAppSubscriptionStatus;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  amountCents: number | null;
  currency: string | null;
  interval: 'month' | 'year' | null;
}

/**
 * @deprecated Prefer per-user routing via `resolveCheckoutProvider`.
 * Kept for callers that only need "is Shopify App Billing configured on this server".
 */
export function isShopifyBillingProvider(): boolean {
  return ShopifyService.isConfigured();
}

/** Checkout provider for a user: connected Shopify store → shopify, otherwise stripe. */
export async function resolveCheckoutProvider(
  userId: string,
  explicit?: 'stripe' | 'shopify',
): Promise<'stripe' | 'shopify'> {
  if (explicit === 'stripe') return 'stripe';
  if (explicit === 'shopify') {
    if (!ShopifyService.isConfigured()) {
      throw new AppError(
        503,
        'Shopify billing is not configured on this server.',
        'SHOPIFY_NOT_CONFIGURED',
      );
    }
    return 'shopify';
  }

  if (ShopifyService.isConfigured() && (await ShopifyService.hasConnection(userId))) {
    return 'shopify';
  }
  return 'stripe';
}

export function isShopifyBillingTestMode(): boolean {
  if (env.SHOPIFY_BILLING_TEST) return true;
  return env.NODE_ENV !== 'production';
}

export function shopifyPriceCentsForPlan(plan: UserPlan): number | null {
  switch (plan) {
    case 'explorer':
      return env.SHOPIFY_PLAN_PRICE_EXPLORER_CENTS;
    case 'pro':
      return env.SHOPIFY_PLAN_PRICE_PRO_CENTS;
    case 'premium':
      return env.SHOPIFY_PLAN_PRICE_PREMIUM_CENTS;
    default:
      return null;
  }
}

export function planFromShopifySubscriptionName(name: string): UserPlan | null {
  const normalized = name.trim().toLowerCase();
  for (const plan of PAID_PLANS) {
    if (normalized === PLAN_DISPLAY[plan].toLowerCase()) return plan;
    if (normalized.includes(plan)) return plan;
  }
  return null;
}

function centsToShopifyAmount(cents: number): number {
  return Math.round(cents) / 100;
}

export const ShopifyBillingService = {
  assertConfigured(): void {
    ShopifyService.assertConfigured();
  },

  listPlanPrices(): Record<UserPlan, number | null> {
    return {
      free: null,
      explorer: shopifyPriceCentsForPlan('explorer'),
      pro: shopifyPriceCentsForPlan('pro'),
      premium: shopifyPriceCentsForPlan('premium'),
    };
  },

  async createCheckout(params: {
    userId: string;
    plan: UserPlan;
    withTrial?: boolean;
    returnUrl?: string;
  }): Promise<{ url: string; subscriptionId: string | null; provider: 'shopify' }> {
    this.assertConfigured();

    const user = await User.findActiveById(params.userId);
    if (user?.stripeSubscriptionId && user.plan !== 'free' && user.billingProvider !== 'shopify') {
      throw new AppError(
        409,
        'You already have an active Stripe subscription. Cancel it before starting Shopify billing.',
        'BILLING_PROVIDER_CONFLICT',
      );
    }

    const amountCents = shopifyPriceCentsForPlan(params.plan);
    if (!amountCents || amountCents <= 0) {
      throw new AppError(
        503,
        `Shopify price for plan "${params.plan}" is not configured`,
        'SHOPIFY_PLAN_PRICE_NOT_CONFIGURED',
      );
    }

    const { shop, accessToken } = await ShopifyService.getConnection(params.userId);
    const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3001';
    const returnUrl =
      params.returnUrl ??
      `${frontendUrl}/billing/success?provider=shopify&plan=${encodeURIComponent(params.plan)}`;
    const withTrial = params.withTrial !== false;
    const trialDays = withTrial ? env.SHOPIFY_BILLING_TRIAL_DAYS : 0;

    const mutation = `
      mutation AppSubscriptionCreate(
        $name: String!
        $returnUrl: URL!
        $trialDays: Int
        $test: Boolean
        $lineItems: [AppSubscriptionLineItemInput!]!
      ) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          trialDays: $trialDays
          test: $test
          lineItems: $lineItems
        ) {
          confirmationUrl
          appSubscription { id status }
          userErrors { field message }
        }
      }
    `;

    const data = await ShopifyService.adminGraphql<{
      appSubscriptionCreate: {
        confirmationUrl: string | null;
        appSubscription: { id: string; status: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(shop, accessToken, mutation, {
      name: PLAN_DISPLAY[params.plan],
      returnUrl,
      trialDays,
      test: isShopifyBillingTestMode(),
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: centsToShopifyAmount(amountCents), currencyCode: 'USD' },
              interval: 'EVERY_30_DAYS',
            },
          },
        },
      ],
    });

    const result = data.appSubscriptionCreate;
    const userErrors = result.userErrors ?? [];
    if (userErrors.length > 0) {
      const msg = userErrors.map((e) => e.message).join('; ');
      throw new AppError(400, msg, 'SHOPIFY_BILLING_ERROR');
    }

    if (!result.confirmationUrl) {
      throw new AppError(502, 'Shopify did not return a confirmation URL', 'SHOPIFY_BILLING_ERROR');
    }

    if (user) {
      user.billingProvider = 'shopify';
      if (result.appSubscription?.id) user.shopifySubscriptionId = result.appSubscription.id;
      if (result.appSubscription?.status) user.shopifyBillingStatus = result.appSubscription.status;
      await user.save();
    }

    log.info('Shopify app subscription checkout created', {
      userId: params.userId,
      plan: params.plan,
      shop,
      subscriptionId: result.appSubscription?.id,
      test: isShopifyBillingTestMode(),
    });

    return {
      url: result.confirmationUrl,
      subscriptionId: result.appSubscription?.id ?? null,
      provider: 'shopify',
    };
  },

  async listActiveSubscriptions(
    shop: string,
    accessToken: string,
  ): Promise<ShopifyAppSubscriptionRow[]> {
    const query = `
      query ValidDsActiveAppSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            test
            trialDays
            currentPeriodEnd
            lineItems {
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    interval
                    price { amount currencyCode }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await ShopifyService.adminGraphql<{
      currentAppInstallation: {
        activeSubscriptions: Array<{
          id: string;
          name: string;
          status: string;
          test: boolean;
          trialDays: number;
          currentPeriodEnd: string | null;
          lineItems: Array<{
            plan: {
              pricingDetails: {
                interval?: string;
                price?: { amount: string; currencyCode: string };
              };
            };
          }>;
        }>;
      } | null;
    }>(shop, accessToken, query);

    const rows = data.currentAppInstallation?.activeSubscriptions ?? [];
    return rows.map((row) => {
      const pricing = row.lineItems[0]?.plan?.pricingDetails;
      const amount = pricing?.price?.amount ? Number(pricing.price.amount) : null;
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        test: row.test,
        trialDays: row.trialDays,
        currentPeriodEnd: row.currentPeriodEnd,
        amountCents: amount !== null ? Math.round(amount * 100) : null,
        currency: pricing?.price?.currencyCode?.toLowerCase() ?? null,
        interval:
          pricing?.interval === 'EVERY_30_DAYS'
            ? 'month'
            : pricing?.interval === 'ANNUAL'
              ? 'year'
              : null,
      };
    });
  },

  async syncUserSubscription(userId: string): Promise<{
    synced: boolean;
    plan: UserPlan;
    subscription: ShopifyAppSubscriptionRow | null;
  }> {
    this.assertConfigured();
    const { shop, accessToken } = await ShopifyService.getConnection(userId);
    const subscriptions = await this.listActiveSubscriptions(shop, accessToken);
    const active =
      subscriptions.find((s) => s.status === 'ACTIVE') ??
      subscriptions.find((s) => s.status === 'PENDING') ??
      null;

    if (!active) {
      await this.downgradeUserByShop(shop);
      return { synced: true, plan: 'free', subscription: null };
    }

    const plan = planFromShopifySubscriptionName(active.name);
    if (!plan) {
      log.warn('Could not map Shopify subscription name to plan', { name: active.name });
      return { synced: false, plan: 'free', subscription: active };
    }

    await this.applyActiveSubscription({
      shop,
      subscription: active,
      plan,
    });

    return { synced: true, plan, subscription: active };
  },

  async applyActiveSubscription(params: {
    shop: string;
    subscription: ShopifyAppSubscriptionRow;
    plan: UserPlan;
  }): Promise<void> {
    const user = await User.findOne({ 'shopifyConnection.shop': params.shop, status: 'active' });
    if (!user) {
      log.warn('applyActiveSubscription: no user for shop', { shop: params.shop });
      return;
    }

    if (user.stripeSubscriptionId && user.billingProvider !== 'shopify') {
      log.warn('applyActiveSubscription skipped — user has Stripe subscription', {
        userId: String(user._id),
        shop: params.shop,
        stripeSubscriptionId: user.stripeSubscriptionId,
      });
      return;
    }

    const { BillingService } = await import('./billing.service');
    await BillingService.provisionShopifyPlan({
      userId: String(user._id),
      userEmail: user.email,
      plan: params.plan,
      shop: params.shop,
      shopifySubscriptionId: params.subscription.id,
      shopifyBillingStatus: params.subscription.status,
      amountCents: params.subscription.amountCents ?? shopifyPriceCentsForPlan(params.plan) ?? 0,
      currency: params.subscription.currency ?? 'usd',
    });
  },

  async downgradeUserByShop(shop: string): Promise<void> {
    const normalized = ShopifyService.normalizeShop(shop);
    const user = await User.findOne({
      'shopifyConnection.shop': normalized,
      billingProvider: 'shopify',
      status: 'active',
    });
    if (!user?.shopifySubscriptionId) return;

    const { BillingService } = await import('./billing.service');
    await BillingService.cancelShopifySubscription(String(user._id));
  },

  async handleSubscriptionWebhook(shop: string, payload: Record<string, unknown>): Promise<void> {
    const sub =
      (payload.app_subscription as Record<string, unknown> | undefined) ??
      (payload as Record<string, unknown>);
    const status = String(sub.status ?? sub.admin_graphql_api_status ?? '').toUpperCase();
    const name = String(sub.name ?? '');
    const gid = String(sub.admin_graphql_api_id ?? sub.id ?? '');

    log.info('Shopify app subscription webhook', { shop, status, name, gid });

    if (status === 'ACTIVE') {
      const plan = planFromShopifySubscriptionName(name);
      if (!plan) {
        log.warn('Webhook subscription name not mapped to plan', { name });
        return;
      }
      await this.applyActiveSubscription({
        shop,
        subscription: {
          id: gid,
          name,
          status,
          test: Boolean(sub.test),
          trialDays: Number(sub.trial_days ?? 0),
          currentPeriodEnd: null,
          amountCents: null,
          currency: 'usd',
          interval: 'month',
        },
        plan,
      });
      return;
    }

    if (['CANCELLED', 'DECLINED', 'EXPIRED', 'FROZEN'].includes(status)) {
      await this.downgradeUserByShop(shop);
    }
  },

  async cancelSubscription(userId: string): Promise<void> {
    this.assertConfigured();
    const user = await User.findActiveById(userId);
    if (!user?.shopifySubscriptionId) {
      throw new AppError(400, 'No active Shopify subscription to cancel', 'NO_ACTIVE_SUBSCRIPTION');
    }

    const { shop, accessToken } = await ShopifyService.getConnection(userId);
    const mutation = `
      mutation AppSubscriptionCancel($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription { id status }
          userErrors { field message }
        }
      }
    `;

    const data = await ShopifyService.adminGraphql<{
      appSubscriptionCancel: {
        appSubscription: { id: string; status: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(shop, accessToken, mutation, { id: user.shopifySubscriptionId });

    const errors = data.appSubscriptionCancel.userErrors ?? [];
    if (errors.length > 0) {
      throw new AppError(502, errors.map((e) => e.message).join('; '), 'SHOPIFY_CANCEL_FAILED');
    }

    const { BillingService } = await import('./billing.service');
    await BillingService.cancelShopifySubscription(userId);
  },
};
