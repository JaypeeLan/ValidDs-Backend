import { Request, Response } from 'express';
import Stripe from 'stripe';
import { getStripe, getStripeWebhookSecret } from '../../services/stripe.service';
import { logger } from '../../logger';

const log = logger.child({ module: 'stripe-webhook' });

/**
 * POST /api/v1/webhooks/stripe
 *
 * Must use the raw request body (see app.ts — registered before express.json).
 * Configure `STRIPE_WEBHOOK_SECRET_TEST` from `stripe listen --forward-to ...` in development.
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
    log.error('Stripe webhook body is not a Buffer — check middleware order');
    res.status(500).send('Invalid webhook body');
    return;
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('Stripe webhook signature verification failed', { msg });
    res.status(400).send(`Webhook signature verification failed: ${msg}`);
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      log.info('checkout.session.completed', { sessionId: session.id, customer: session.customer });
      // TODO: map session.client_reference_id or metadata.userId to User and update plan / credits
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      log.info(event.type, { id: (event.data.object as Stripe.Subscription).id });
      break;
    default:
      log.debug('Unhandled Stripe event type', { type: event.type });
  }

  res.status(200).json({ received: true });
}
