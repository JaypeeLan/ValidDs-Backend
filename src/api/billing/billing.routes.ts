import { Router } from 'express';
import { BillingController } from './billing.controller';

const router = Router();

router.get('/stripe-config', BillingController.stripeConfig);

export default router;
