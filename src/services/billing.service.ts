import { User, UserPlan, PLAN_LIMITS } from '../models/user.model';

/** Plans that can be purchased via Stripe Checkout (see POST /billing/checkout). */
const CHECKOUT_PLAN_IDS: UserPlan[] = ['trial', 'explorer', 'pro', 'premium'];

export type PublicPlanRow = {
  id: UserPlan;
  limits: (typeof PLAN_LIMITS)['free'];
  checkoutMode: 'payment' | 'subscription';
  stripePriceConfigured: boolean;
  /** Present when Stripe returned a price; amounts may still be null if Stripe has no unit_amount. */
  price: {
    amountCents: number | null;
    currency: string | null;
    interval: 'month' | 'year' | null;
  } | null;
};
import { Transaction } from '../models/transaction.model';
import { SocketService } from '../config/socket';
import { getStripe, getPriceIdForPlan, isStripeLiveMode } from './stripe.service';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'billing-service' });

// ── Plan → credit allocation ──────────────────────────────────────────────────

export function creditsForPlan(plan: UserPlan): number {
  return PLAN_LIMITS[plan]?.creditsPerMonth ?? PLAN_LIMITS.free.creditsPerMonth;
}

// ── BillingService ────────────────────────────────────────────────────────────

export class BillingService {

  /**
   * Public catalog for pricing UI: limits per plan, Stripe-backed price when available,
   * and default success/cancel URLs for Checkout (same defaults as createCheckoutSession).
   */
  static async listPublicPlans(): Promise<{
    mode: 'test' | 'live';
    plans: PublicPlanRow[];
    checkoutRedirects: {
      defaultSuccessUrl: string;
      defaultCancelUrl: string;
    };
  }> {
    const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3001';
    const stripe = getStripe();
    const plans: PublicPlanRow[] = [];

    for (const plan of CHECKOUT_PLAN_IDS) {
      const limits = PLAN_LIMITS[plan];
      const checkoutMode = plan === 'trial' ? 'payment' : 'subscription';
      const priceId = getPriceIdForPlan(plan);
      const stripePriceConfigured = Boolean(priceId);

      let price: PublicPlanRow['price'] = null;
      if (stripe && priceId) {
        try {
          const p = await stripe.prices.retrieve(priceId);
          const interval =
            p.recurring?.interval === 'month' || p.recurring?.interval === 'year'
              ? p.recurring.interval
              : null;
          price = {
            amountCents: p.unit_amount,
            currency: p.currency ? p.currency.toLowerCase() : null,
            interval: p.type === 'recurring' ? interval : null,
          };
        } catch (err) {
          log.warn('listPublicPlans: Stripe price retrieve failed', { plan, priceId, err });
          price = { amountCents: null, currency: null, interval: null };
        }
      }

      plans.push({
        id: plan,
        limits: { ...limits },
        checkoutMode,
        stripePriceConfigured,
        price,
      });
    }

    return {
      mode: isStripeLiveMode() ? 'live' : 'test',
      plans,
      checkoutRedirects: {
        defaultSuccessUrl: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        defaultCancelUrl: `${frontendUrl}/billing`,
      },
    };
  }

  /**
   * Deducts credits from the user's balance.
   * Emits a real-time WebSocket event on success for UI sync.
   * Returns true on success, false if insufficient credits.
   */
  static async deductCredits(
    userId: string,
    amount: number,
    actionName = 'internal_action'
  ): Promise<boolean> {
    const user = await User.findActiveById(userId);
    if (!user) {
      log.warn('Billing action on unknown/inactive user', { userId });
      return false;
    }

    const success = await user.deductCredits(amount);

    if (success) {
      log.info('Credits deducted', { userId, amount, action: actionName, remaining: user.creditBalance });
      try {
        SocketService.emitToUser(userId, 'creditBalanceUpdated', {
          userId,
          newBalance: user.creditBalance,
          deductedAmount: amount,
          action: actionName,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        log.error('Socket broadcast failed', { userId, err });
      }
    } else {
      log.warn('Insufficient credits', { userId, required: amount, available: user.creditBalance, action: actionName });
    }

    return success;
  }

  /**
   * Creates a Stripe Checkout Session for a subscription plan.
   * Returns the session URL to redirect the user to.
   *
   * Pass `successUrl` / `cancelUrl` from the request, or fall back to
   * FRONTEND_URL-based defaults.
   */
  static async createCheckoutSession(params: {
    userId: string;
    userEmail: string;
    stripeCustomerId?: string;
    plan: UserPlan;
    priceId: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<{ url: string; sessionId: string }> {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');

    const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3001';
    const successUrl = params.successUrl ?? `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = params.cancelUrl  ?? `${frontendUrl}/billing`;

    // trial is a one-time $1 payment; all other plans are recurring subscriptions
    const isOneTime = params.plan === 'trial';
    const mode = isOneTime ? 'payment' : 'subscription';

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items:          [{ price: params.priceId, quantity: 1 }],
      client_reference_id: params.userId,
      success_url:         successUrl,
      cancel_url:          cancelUrl,
      // Always create a customer record so we can identify the user in webhooks
      ...(isOneTime ? { customer_creation: 'always' } : {}),
      metadata: {
        userId: params.userId,
        plan:   params.plan,
      },
      // Reuse existing Stripe customer if we have one, otherwise pre-fill email
      ...(params.stripeCustomerId
        ? { customer: params.stripeCustomerId }
        : { customer_email: params.userEmail }),
    });

    if (!session.url) throw new Error('Stripe did not return a checkout URL');

    log.info('Checkout session created', { userId: params.userId, plan: params.plan, sessionId: session.id });

    return { url: session.url, sessionId: session.id };
  }

  /**
   * Provisions a paid plan on the user after a successful Stripe payment.
   * - Updates user plan, credits, and Stripe IDs
   * - Writes a Transaction record (idempotent — skipped if already recorded)
   */
  static async provisionPlan(params: {
    userId:                string;
    userEmail:             string;
    plan:                  UserPlan;
    stripeCustomerId:      string;   // empty string for one-time payments without customer
    stripeSubscriptionId:  string;   // empty string for one-time payments
    stripePriceId:         string;
    amount:                number;   // in cents
    currency:              string;
    stripePaymentIntentId: string | null;
    stripeSessionId:       string;
  }): Promise<void> {
    // Idempotency guard — skip if we already processed this session
    const existing = await Transaction.findOne({ reference: params.stripeSessionId });
    if (existing) {
      log.info('provisionPlan skipped — already processed', { sessionId: params.stripeSessionId });
      return;
    }

    const user = await User.findActiveById(params.userId);
    if (!user) {
      log.error('provisionPlan: user not found', { userId: params.userId });
      return;
    }

    const credits = creditsForPlan(params.plan);

    user.plan                  = params.plan;
    user.creditBalance         = credits;
    user.stripeCustomerId      = params.stripeCustomerId;
    user.stripeSubscriptionId  = params.stripeSubscriptionId;
    user.stripePriceId         = params.stripePriceId;
    user.planExpiresAt         = undefined;  // subscription handles its own renewal
    await user.save();

    await Transaction.create({
      userId:                user._id,
      userEmail:             params.userEmail || user.email,
      provider:              'stripe',
      mode:                  isStripeLiveMode() ? 'live' : 'test',
      status:                'paid',
      amount:                params.amount / 100,   // cents → dollars
      currency:              (params.currency ?? 'usd').toUpperCase(),
      reference:             params.stripeSessionId,
      stripePaymentIntentId: params.stripePaymentIntentId ?? undefined,
      stripeCustomerId:      params.stripeCustomerId,
      metadata:              { plan: params.plan, priceId: params.stripePriceId },
    });

    log.info('Plan provisioned', {
      userId:  params.userId,
      plan:    params.plan,
      credits,
      amount:  params.amount / 100,
    });

    // Notify the frontend in real time
    try {
      SocketService.emitToUser(params.userId, 'planUpgraded', {
        plan:          params.plan,
        creditBalance: credits,
        timestamp:     new Date().toISOString(),
      });
    } catch (err) {
      log.warn('Socket emit failed after plan provision', { userId: params.userId, err });
    }
  }

  /**
   * Refreshes a user's credit balance at the start of a new billing period.
   * Called on `invoice.paid` for subscription renewals.
   */
  static async refreshCreditsForRenewal(stripeCustomerId: string): Promise<void> {
    const user = await User.findOne({ stripeCustomerId, status: 'active' });
    if (!user) {
      log.warn('refreshCreditsForRenewal: user not found', { stripeCustomerId });
      return;
    }

    const credits = creditsForPlan(user.plan as UserPlan);
    user.creditBalance = credits;
    await user.save();

    log.info('Credits refreshed for renewal', { userId: String(user._id), plan: user.plan, credits });

    try {
      SocketService.emitToUser(String(user._id), 'creditBalanceUpdated', {
        userId:      String(user._id),
        newBalance:  credits,
        action:      'subscription_renewal',
        timestamp:   new Date().toISOString(),
      });
    } catch (err) {
      log.warn('Socket emit failed after renewal refresh', { err });
    }
  }

  /**
   * Downgrades the user to the free plan when a subscription is cancelled/deleted.
   */
  static async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    const user = await User.findOne({ stripeSubscriptionId, status: 'active' });
    if (!user) {
      log.warn('cancelSubscription: user not found', { stripeSubscriptionId });
      return;
    }

    user.plan                 = 'free';
    user.creditBalance        = creditsForPlan('free');
    user.stripeSubscriptionId = undefined;
    user.stripePriceId        = undefined;
    await user.save();

    log.info('Subscription cancelled — downgraded to free', { userId: String(user._id) });
  }
}
