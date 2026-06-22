import { Router } from 'express';
import { BillingController } from './billing.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { BillingTransactionsQuerySchema } from './billing.validator';

const router = Router();

// Public
router.get('/stripe-config', BillingController.stripeConfig);
router.get('/plans', BillingController.listPlans);

// Auth required
router.post('/checkout', requireAuth, BillingController.createCheckoutSession);
router.get('/subscription', requireAuth, BillingController.getSubscription);
router.get(
  '/transactions',
  requireAuth,
  validate(BillingTransactionsQuerySchema, 'query'),
  BillingController.getTransactions,
);

export default router;
