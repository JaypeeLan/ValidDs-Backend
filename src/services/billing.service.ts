import { User, UserPlan, PLAN_LIMITS } from '../models/user.model';
import { Transaction } from '../models/transaction.model';
import { SocketService } from '../config/socket';
import { getStripe, getPriceIdForPlan, isStripeLiveMode, STRIPE_TRIAL_DAYS } from './stripe.service';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'billing-service' });

// ── Plan → credit allocation ──────────────────────────────────────────────────

export function creditsForPlan(plan: UserPlan): number {
  return PLAN_LIMITS[plan]?.creditsPerMonth ?? PLAN_LIMITS.free.creditsPerMonth;
}

// ── Public plan catalog type (used by GET /billing/plans) ────────────────────

/** Plans available for purchase — free is not purchasable. */
const PAID_PLANS: UserPlan[] = ['explorer', 'pro', 'premium'];

export type PublicPlanRow = {
  id: UserPlan;
  limits: (typeof PLAN_LIMITS)['free'];
  trialDays: number;
  stripePriceConfigured: boolean;
  /** Fetched live from Stripe; null when Stripe is not configured or price lookup fails. */
  price: {
    amountCents: number | null;
    currency: string | null;
    interval: 'month' | 'year' | null;
  } | null;
};

// ── BillingService ────────────────────────────────────────────────────────────

export class BillingService {

  /**
   * Public catalog for the pricing UI.
   * Fetches live price data from Stripe so the frontend always shows accurate amounts.
   */
  static async listPublicPlans(): Promise<{
    mode: 'test' | 'live';
    trialDays: number;
    plans: PublicPlanRow[];
    checkoutRedirects: { defaultSuccessUrl: string; defaultCancelUrl: string };
  }> {
    const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3001';
    const stripe = getStripe();
    const plans: PublicPlanRow[] = [];

    for (const plan of PAID_PLANS) {
      const priceId = getPriceIdForPlan(plan);
      let price: PublicPlanRow['price'] = null;

      if (stripe && priceId) {
        try {
          const p = await stripe.prices.retrieve(priceId);
          price = {
            amountCents: p.unit_amount,
            currency:    p.currency?.toLowerCase() ?? null,
            interval:    p.recurring?.interval === 'month' || p.recurring?.interval === 'year'
              ? p.recurring.interval
              : null,
          };
        } catch (err) {
          log.warn('listPublicPlans: Stripe price retrieve failed', { plan, priceId, err });
          price = { amountCents: null, currency: null, interval: null };
        }
      }

      plans.push({
        id:                    plan,
        limits:                { ...PLAN_LIMITS[plan] },
        trialDays:             STRIPE_TRIAL_DAYS,
        stripePriceConfigured: Boolean(priceId),
        price,
      });
    }

    return {
      mode: isStripeLiveMode() ? 'live' : 'test',
      trialDays: STRIPE_TRIAL_DAYS,
      plans,
      checkoutRedirects: {
        defaultSuccessUrl: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        defaultCancelUrl:  `${frontendUrl}/billing`,
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
          newBalance:     user.creditBalance,
          deductedAmount: amount,
          action:         actionName,
          timestamp:      new Date().toISOString(),
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
   * Creates a Stripe Checkout Session for a paid plan.
   * All plans are recurring subscriptions.
   * Pass withTrial: true (default) to start with a 7-day free trial.
   * Pass withTrial: false to charge immediately on signup.
   */
  static async createCheckoutSession(params: {
    userId:           string;
    userEmail:        string;
    stripeCustomerId?: string;
    plan:             UserPlan;
    priceId:          string;
    withTrial?:       boolean;   // default true
    successUrl?:      string;
    cancelUrl?:       string;
  }): Promise<{ url: string; sessionId: string }> {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');

    const withTrial = params.withTrial !== false;  // true unless explicitly false
    const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:3001';
    const successUrl = params.successUrl ?? `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = params.cancelUrl  ?? `${frontendUrl}/billing`;

    const session = await stripe.checkout.sessions.create({
      mode:                'subscription',
      line_items:          [{ price: params.priceId, quantity: 1 }],
      client_reference_id: params.userId,
      success_url:         successUrl,
      cancel_url:          cancelUrl,
      // Carry plan + userId into the subscription itself so webhook handlers
      // can resolve plan from customer.subscription.updated events
      subscription_data: {
        ...(withTrial ? { trial_period_days: STRIPE_TRIAL_DAYS } : {}),
        metadata: {
          userId: params.userId,
          plan:   params.plan,
        },
      },
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

    log.info('Checkout session created', {
      userId:    params.userId,
      plan:      params.plan,
      sessionId: session.id,
      trialDays: withTrial ? STRIPE_TRIAL_DAYS : 0,
    });

    return { url: session.url, sessionId: session.id };
  }

  /**
   * Provisions a paid plan on the user after a successful Stripe checkout.
   * - Updates user plan, credits, and Stripe IDs
   * - Writes a Transaction record (idempotent — skipped if already recorded)
   * - Amount may be 0 for trial sessions (no charge yet)
   */
  static async provisionPlan(params: {
    userId:                string;
    userEmail:             string;
    plan:                  UserPlan;
    stripeCustomerId:      string;
    stripeSubscriptionId:  string;
    stripePriceId:         string;
    amount:                number;   // in cents (0 during trial)
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

    user.plan                 = params.plan;
    user.creditBalance        = credits;
    user.stripeCustomerId     = params.stripeCustomerId;
    user.stripeSubscriptionId = params.stripeSubscriptionId;
    user.stripePriceId        = params.stripePriceId;
    user.planExpiresAt        = undefined;  // subscription handles its own renewal
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
        userId:     String(user._id),
        newBalance: credits,
        action:     'subscription_renewal',
        timestamp:  new Date().toISOString(),
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
