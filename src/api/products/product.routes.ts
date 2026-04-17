import { Router } from 'express';
import { ProductController } from './product.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { ProductFeedQuerySchema, ProductKeywordContextQuerySchema } from './product.validator';

const router = Router();

/**
 * Product Routes
 *
 * GET /products — paginated list (all active products) or full-text search when `q` is set
 * GET /products/categories — list unique categories
 * GET /products/:id — product detail
 *
 * All routes use requireAuth — authentication is mandatory for all endpoints.
 */

router.get(
  '/',
  requireAuth,
  validate(ProductFeedQuerySchema, 'query'),
  ProductController.feed
);

router.get(
  '/keyword-context',
  requireAuth,
  validate(ProductKeywordContextQuerySchema, 'query'),
  ProductController.keywordContext
);

router.get('/categories', requireAuth, ProductController.categories);
router.get('/saved', requireAuth, ProductController.saved);

// :id must come last — otherwise static segments like "categories" match as an id
router.get('/:id', requireAuth, ProductController.detail);

export default router;
