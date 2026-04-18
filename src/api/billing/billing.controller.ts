import { Request, Response, NextFunction } from 'express';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { getStripe, getStripePublishableKey, isStripeLiveMode } from '../../services/stripe.service';

export const BillingController = {
  /**
   * GET /api/v1/billing/stripe-config
   * Public: exposes publishable key for Stripe.js on the frontend.
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
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
