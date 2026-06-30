import { Router } from 'express';
import { BillingController } from './billing.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { BillingTransactionsQuerySchema, CancelSubscriptionBodySchema } from './billing.validator';

const router = Router();

router.use(requireAuth);

router.get('/stripe-config', BillingController.stripeConfig);
router.get('/plans', BillingController.listPlans);
router.post('/checkout', BillingController.createCheckoutSession);
router.get('/subscription', BillingController.getSubscription);
router.post(
  '/subscription/cancel',
  validate(CancelSubscriptionBodySchema, 'body'),
  BillingController.cancelSubscription,
);
router.get(
  '/transactions',
  validate(BillingTransactionsQuerySchema, 'query'),
  BillingController.getTransactions,
);

export default router;
