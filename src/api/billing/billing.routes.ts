import { Router } from 'express';
import { BillingController } from './billing.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

// Public
router.get('/stripe-config', BillingController.stripeConfig);
router.get('/plans', BillingController.listPlans);

// Auth required
router.post('/checkout',     requireAuth, BillingController.createCheckoutSession);
router.get('/subscription',  requireAuth, BillingController.getSubscription);

export default router;
