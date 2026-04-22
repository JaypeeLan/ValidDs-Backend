import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { getStripe, getStripePublishableKey, isStripeLiveMode, getPriceIdForPlan } from '../../services/stripe.service';
import { BillingService } from '../../services/billing.service';
import { UserPlan, IUserDocument } from '../../models/user.model';
import { Transaction } from '../../models/transaction.model';

// ── Validation ────────────────────────────────────────────────────────────────

const CheckoutBodySchema = z.object({
  plan:       z.enum(['trial', 'explorer', 'pro', 'premium'] as const),
  successUrl: z.string().url().optional(),
  cancelUrl:  z.string().url().optional(),
});

// ── Controller ────────────────────────────────────────────────────────────────

export const BillingController = {

  /**
   * GET /api/v1/billing/plans
   * Public — paid plan catalog (limits), optional live prices from Stripe, and default Checkout redirect URLs.
   */
  async listPlans(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = await BillingService.listPublicPlans();
      res.json(successResponse(payload, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/billing/stripe-config
   * Public — returns publishable key for Stripe.js on the frontend.
   */
  stripeConfig(_req: Request, res: Response, next: NextFunction): void {
    try {
      const publishableKey = getStripePublishableKey();
      if (!publishableKey) {
        res.status(503).json({
          success:    false,
          message:    'Stripe publishable key is not configured for this environment.',
          statusCode: 503,
        });
        return;
      }

      const stripe = getStripe();
      res.json(
        successResponse(
          {
            publishableKey,
            mode:                isStripeLiveMode() ? 'live' : 'test',
            secretKeyConfigured: Boolean(stripe),
          },
          ResponseMessage.SUCCESS,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/billing/checkout
   * Auth required — creates a Stripe Checkout Session for the requested plan.
   * Returns { url, sessionId }; open `url` in the browser to complete payment on Stripe.
   *
   * Body: { plan: 'trial' | 'explorer' | 'pro' | 'premium', successUrl?, cancelUrl? }
   * Omit URLs to use defaults from GET /billing/plans → checkoutRedirects (FRONTEND_URL-based).
   */
  async createCheckoutSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = CheckoutBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success:    false,
          message:    parsed.error.errors[0].message,
          statusCode: 400,
        });
        return;
      }

      const { plan, successUrl, cancelUrl } = parsed.data;
      const user = req.user as IUserDocument;

      const priceId = getPriceIdForPlan(plan as UserPlan);
      if (!priceId) {
        res.status(503).json({
          success:    false,
          message:    `Stripe price ID for plan "${plan}" is not configured.`,
          statusCode: 503,
        });
        return;
      }

      const { url, sessionId } = await BillingService.createCheckoutSession({
        userId:           String(user._id),
        userEmail:        user.email,
        stripeCustomerId: user.stripeCustomerId,
        plan:             plan as UserPlan,
        priceId,
        successUrl,
        cancelUrl,
      });

      res.json(
        successResponse({ url, sessionId }, ResponseMessage.SUCCESS, 200)
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/billing/subscription
   * Auth required — returns the current user's plan, credit balance, and billing info.
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
            plan:                user.plan,
            creditBalance:       user.creditBalance,
            planExpiresAt:       user.planExpiresAt ?? null,
            stripeCustomerId:    user.stripeCustomerId ?? null,
            stripeSubscriptionId:user.stripeSubscriptionId ?? null,
            mode:                isStripeLiveMode() ? 'live' : 'test',
            transactions,
          },
          ResponseMessage.SUCCESS,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
