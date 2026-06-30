import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import {
  getStripe,
  getStripePublishableKey,
  isStripeLiveMode,
  getPriceIdForPlan,
} from '../../services/stripe.service';
import { BillingService } from '../../services/billing.service';
import { TransactionService } from '../../services/transaction.service';
import { UserPlan, IUserDocument } from '../../models/user.model';
import { Transaction } from '../../models/transaction.model';
import type {
  BillingTransactionsQueryInput,
  CancelSubscriptionBodyInput,
} from './billing.validator';

// ── Validation ────────────────────────────────────────────────────────────────

const CheckoutBodySchema = z.object({
  plan: z.enum(['explorer', 'pro', 'premium'] as const),
  withTrial: z.boolean().optional().default(true),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

// ── Controller ────────────────────────────────────────────────────────────────

export const BillingController = {
  /**
   * GET /api/v1/billing/stripe-config
   * Public — returns publishable key for Stripe.js on the frontend.
   */
  stripeConfig(_req: Request, res: Response, next: NextFunction): void {
    try {
      const publishableKey = getStripePublishableKey();
      if (!publishableKey) {
        res.status(503).json({
          success: false,
          message: 'Stripe publishable key is not configured for this environment.',
          statusCode: 503,
        });
        return;
      }

      const stripe = getStripe();
      res.json(
        successResponse(
          {
            publishableKey,
            mode: isStripeLiveMode() ? 'live' : 'test',
            secretKeyConfigured: Boolean(stripe),
          },
          ResponseMessage.SUCCESS,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/billing/plans
   * Public — returns all purchasable plans with live Stripe pricing, credit limits,
   * trial days, and default success/cancel redirect URLs for checkout.
   *
   * Frontend uses this to render the pricing page and to know which plan ID to
   * send to POST /checkout.
   */
  async listPlans(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await BillingService.listPublicPlans();
      res.json(successResponse(data, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/billing/checkout
   * Auth required — creates a Stripe Checkout Session for the requested plan.
   *
   * Body: { plan: 'explorer' | 'pro' | 'premium', successUrl?, cancelUrl? }
   * Returns: { url }  — frontend redirects the browser to this URL.
   *
   * After payment Stripe redirects to:
   *   Success → FRONTEND_URL/billing/success?session_id=cs_...
   *   Cancel  → FRONTEND_URL/billing
   *
   * All plans include a 7-day free trial (card required, not charged until trial ends).
   */
  async createCheckoutSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = CheckoutBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          message: parsed.error.errors[0].message,
          statusCode: 400,
        });
        return;
      }

      const { plan, withTrial, successUrl, cancelUrl } = parsed.data;
      const user = req.user as IUserDocument;

      const priceId = getPriceIdForPlan(plan as UserPlan);
      if (!priceId) {
        res.status(503).json({
          success: false,
          message: `Stripe price ID for plan "${plan}" is not configured.`,
          statusCode: 503,
        });
        return;
      }

      const { url, sessionId } = await BillingService.createCheckoutSession({
        userId: String(user._id),
        userEmail: user.email,
        stripeCustomerId: user.stripeCustomerId,
        plan: plan as UserPlan,
        priceId,
        withTrial,
        successUrl,
        cancelUrl,
      });

      res.json(successResponse({ url, sessionId }, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/billing/subscription
   * Auth required — returns the current user's active plan, credit balance, Stripe IDs,
   * and the last 10 transactions.
   *
   * Frontend calls this after the Stripe success redirect to confirm the plan is active.
   */
  async getSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as IUserDocument;

      const transactions = await Transaction.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      res.json(
        successResponse(
          {
            plan: user.plan,
            creditBalance: user.creditBalance,
            planExpiresAt: user.planExpiresAt ?? null,
            stripeCustomerId: user.stripeCustomerId ?? null,
            stripeSubscriptionId: user.stripeSubscriptionId ?? null,
            mode: isStripeLiveMode() ? 'live' : 'test',
            transactions,
          },
          ResponseMessage.SUCCESS,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/billing/subscription/cancel
   * Auth required — cancels the user's active Stripe subscription.
   *
   * Body: { immediate?: boolean } — default false (cancel at period end).
   */
  async cancelSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CancelSubscriptionBodyInput;
      const user = req.user as IUserDocument;

      const result = await BillingService.requestSubscriptionCancellation(String(user._id), {
        immediate: body.immediate,
      });

      res.json(successResponse(result, ResponseMessage.SUBSCRIPTION_CANCELLED, 200));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/billing/transactions
   * Auth required — paginated billing history for the authenticated user.
   */
  async getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as BillingTransactionsQueryInput;
      const user = req.user as IUserDocument;

      const data = await TransactionService.listForUser(String(user._id), query);

      res.json(successResponse(data, ResponseMessage.BILLING_HISTORY_RETRIEVED, 200));
    } catch (err) {
      next(err);
    }
  },
};
