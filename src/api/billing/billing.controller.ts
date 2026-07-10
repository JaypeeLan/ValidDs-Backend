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
import {
  isShopifyBillingTestMode,
  resolveCheckoutProvider,
  ShopifyBillingService,
} from '../../services/shopify-billing.service';
import { ShopifyService } from '../../services/shopify.service';
import type {
  BillingTransactionsQueryInput,
  CancelSubscriptionBodyInput,
} from './billing.validator';

const CheckoutBodySchema = z.object({
  provider: z.enum(['stripe', 'shopify']).optional(),
  plan: z.enum(['explorer', 'pro', 'premium'] as const),
  withTrial: z.boolean().optional().default(true),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export const BillingController = {
  async billingConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as IUserDocument;
      const stripeConfigured = Boolean(getStripe());
      const shopifyConfigured = ShopifyService.isConfigured();
      const hasShopifyStore = shopifyConfigured
        ? await ShopifyService.hasConnection(String(user._id))
        : false;
      const defaultProvider = await resolveCheckoutProvider(String(user._id));

      res.json(
        successResponse(
          {
            providers: [
              ...(stripeConfigured ? (['stripe'] as const) : []),
              ...(shopifyConfigured ? (['shopify'] as const) : []),
            ],
            defaultProvider,
            stripeConfigured,
            shopifyConfigured,
            hasShopifyStore,
            shopifyBillingEnabled: shopifyConfigured,
            shopifyBillingTest: isShopifyBillingTestMode(),
            requiresShopifyStore: defaultProvider === 'shopify',
          },
          ResponseMessage.SUCCESS,
          200,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

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

  async listPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as IUserDocument;
      const data = await BillingService.listPublicPlans(String(user._id));
      res.json(successResponse(data, ResponseMessage.SUCCESS, 200));
    } catch (err) {
      next(err);
    }
  },

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
      const provider = await resolveCheckoutProvider(String(user._id), parsed.data.provider);

      if (provider === 'shopify') {
        const result = await ShopifyBillingService.createCheckout({
          userId: String(user._id),
          plan: plan as UserPlan,
          withTrial,
          returnUrl: successUrl,
        });

        res.json(
          successResponse(
            {
              url: result.url,
              sessionId: result.subscriptionId,
              provider: 'shopify',
            },
            ResponseMessage.SUCCESS,
            200,
          ),
        );
        return;
      }

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

      res.json(
        successResponse({ url, sessionId, provider: 'stripe' }, ResponseMessage.SUCCESS, 200),
      );
    } catch (err) {
      next(err);
    }
  },

  async syncShopifySubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user as IUserDocument;
      const result = await ShopifyBillingService.syncUserSubscription(String(user._id));
      res.json(successResponse(result, 'Shopify subscription synced', 200));
    } catch (err) {
      next(err);
    }
  },

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
            billingProvider: user.billingProvider ?? 'stripe',
            stripeCustomerId: user.stripeCustomerId ?? null,
            stripeSubscriptionId: user.stripeSubscriptionId ?? null,
            shopifySubscriptionId: user.shopifySubscriptionId ?? null,
            shopifyBillingStatus: user.shopifyBillingStatus ?? null,
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
