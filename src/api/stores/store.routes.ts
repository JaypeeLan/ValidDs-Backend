import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { StoreController } from './store.controller';
import {
  ShopifyAddProductSchema,
  ShopifyCallbackQuerySchema,
  ShopifyInstallQuerySchema,
} from './store.validator';

const router = Router();

/**
 * Store Routes — Shopify integration
 *
 * Public (browser hits these directly during OAuth):
 *   GET   /shopify/callback           → OAuth callback from Shopify
 *
 * Authenticated:
 *   GET   /shopify/install            → Start OAuth, OR return signup URL
 *   GET   /shopify/status             → Is the user's store connected?
 *   POST  /shopify/disconnect         → Disconnect the store
 *   POST  /shopify/products           → Push a ValidDs product to Shopify
 */

router.get(
  '/shopify/install',
  requireAuth,
  validate(ShopifyInstallQuerySchema, 'query'),
  StoreController.install
);

router.get(
  '/shopify/callback',
  validate(ShopifyCallbackQuerySchema, 'query'),
  StoreController.callback
);

router.get('/shopify/status', requireAuth, StoreController.status);
router.post('/shopify/disconnect', requireAuth, StoreController.disconnect);

router.post(
  '/shopify/products',
  requireAuth,
  validate(ShopifyAddProductSchema, 'body'),
  StoreController.addProduct
);

export default router;
