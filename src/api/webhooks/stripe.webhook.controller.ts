import { Request, Response } from 'express';
import Stripe from 'stripe';
import { getStripe, getStripeWebhookSecret } from '../../services/stripe.service';
import { BillingService, creditsForPlan } from '../../services/billing.service';
import { User, UserPlan, PLAN_LIMITS } from '../../models/user.model';
import { logger } from '../../logger';

const log = logger.child({ module: 'stripe-webhook' });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safely extract a string field from Stripe metadata */
function meta(obj: Stripe.Metadata | null | undefined, key: string): string | undefined {
  return obj?.[key] ?? undefined;
}

/** Resolve plan name from a Stripe subscription's price ID via metadata or price lookup */
function planFromMetadata(metadata: Stripe.Metadata | null | undefined): UserPlan | undefined {
  const plan = meta(metadata, 'plan') as UserPlan | undefined;
  if (plan && plan in PLAN_LIMITS) return plan;
  return undefined;
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/v1/webhooks/stripe
 *
 * Must use raw request body (see app.ts — registered before express.json).
 * Configure STRIPE_WEBHOOK_SECRET_TEST from `stripe listen --forward-to ...` in dev.
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const stripe = getStripe();
  const webhookSecret = getStripeWebhookSecret();
  const sig = req.headers['stripe-signature'];

  if (!stripe || !webhookSecret) {
    log.warn('Stripe webhook received but Stripe or webhook secret is not configured');
    res.status(503).send('Stripe webhook not configured');
    return;
  }

  if (typeof sig !== 'string') {
    res.status(400).send('Missing stripe-signature header');
    return;
  }

  const payload = req.body;
  if (!Buffer.isBuffer(payload)) {
    log.error('Stripe webhook body is not a Buffer — check middleware order in app.ts');
    res.status(500).send('Invalid webhook body');
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Stripe webhook signature verification failed', { msg });
    res.status(400).send(`Webhook signature verification failed: ${msg}`);
    return;
  }

  log.info('Stripe webhook received', { type: event.type, id: event.id });

  try {
    await dispatchEvent(stripe, event);
  } catch (err) {
    // Log but still return 200 — prevents Stripe from retrying transient errors
    log.error('Stripe webhook handler threw', { type: event.type, err: String(err) });
  }

  res.status(200).json({ received: true });
}

// ── Event dispatcher ──────────────────────────────────────────────────────────

async function dispatchEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {

    // ── New payment completed ─────────────────────────────────────────────────
    case 'checkout.session.completed':
      await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
      break;

    // ── Subscription changes ──────────────────────────────────────────────────
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    // ── Renewal billing ───────────────────────────────────────────────────────
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    default:
      log.debug('Unhandled Stripe event type', { type: event.type });
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * checkout.session.completed
 * Fired when a user completes checkout (card entered, trial starts).
 * All plans are subscriptions — amount_total is 0 when the trial is active.
 */
async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<void> {
  const userId = session.client_reference_id ?? meta(session.metadata, 'userId');
  if (!userId) {
    log.error('checkout.session.completed: no userId in client_reference_id or metadata', { sessionId: session.id });
    return;
  }

  const plan = planFromMetadata(session.metadata);
  if (!plan) {
    log.error('checkout.session.completed: no valid plan in session metadata', { sessionId: session.id, metadata: session.metadata });
    return;
  }

  const customerId = (typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id) ?? '';

  const subId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  if (!subId) {
    log.error('checkout.session.completed: missing subscription ID', { sessionId: session.id });
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subId);
  const priceId      = subscription.items.data[0]?.price?.id ?? '';

  // During a trial the session total is $0 and there is no payment_intent yet
  const amount   = session.amount_total ?? 0;
  const currency = session.currency ?? 'usd';
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);

  await BillingService.provisionPlan({
    userId,
    userEmail:             session.customer_details?.email ?? '',
    plan,
    stripeCustomerId:      customerId,
    stripeSubscriptionId:  subId,
    stripePriceId:         priceId,
    amount,
    currency,
    stripePaymentIntentId: paymentIntentId,
    stripeSessionId:       session.id,
  });
}

/**
 * customer.subscription.updated
 * Fired on plan changes, cancellations scheduled, trial ends, etc.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  if (!customerId) return;

  const user = await User.findOne({ stripeCustomerId: customerId, status: 'active' });
  if (!user) {
    log.warn('subscription.updated: no user found for customer', { customerId });
    return;
  }

  // Subscription was cancelled at period end — let it run out, no immediate action
  if (subscription.cancel_at_period_end) {
    log.info('Subscription scheduled to cancel at period end', {
      userId:    String(user._id),
      cancelAt:  subscription.cancel_at,
    });
    return;
  }

  // Status change (e.g. past_due, unpaid) — log for now
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    log.warn('Subscription status changed to non-active', {
      userId: String(user._id),
      status: subscription.status,
    });
    return;
  }

  // Plan changed mid-cycle (upgrade/downgrade)
  const newPriceId = subscription.items.data[0]?.price?.id;
  if (newPriceId && newPriceId !== user.stripePriceId) {
    const plan = planFromMetadata(subscription.metadata);
    if (plan) {
      user.plan          = plan;
      user.creditBalance = creditsForPlan(plan);
      user.stripePriceId = newPriceId;
      await user.save();
      log.info('Plan updated via subscription change', { userId: String(user._id), plan });
    }
  }
}

/**
 * customer.subscription.deleted
 * Fired when a subscription fully ends. Downgrade to free.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await BillingService.cancelSubscription(subscription.id);
}

/**
 * invoice.paid
 * Fired on successful renewal billing. Refresh the user's monthly credits.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  // Only process subscription renewals (not the initial payment — that's covered by checkout.session.completed)
  const billingReason = (invoice as any).billing_reason as string | undefined;
  if (billingReason === 'subscription_create') {
    log.debug('invoice.paid: skipping subscription_create (handled by checkout.session.completed)');
    return;
  }

  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : (invoice.customer as any)?.id;

  if (!customerId) return;

  await BillingService.refreshCreditsForRenewal(customerId);
}

/**
 * invoice.payment_failed
 * Fired when a renewal charge fails. Log and optionally notify the user.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : (invoice.customer as any)?.id;

  log.warn('Invoice payment failed', {
    invoiceId:  invoice.id,
    customerId,
    amount:     invoice.amount_due,
    attemptCount: invoice.attempt_count,
  });
  // TODO: Send an email via ResendService to warn the user their payment failed
}
