import { Router } from 'express';
import { ProductController } from './product.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { ProductFeedQuerySchema, ProductSearchQuerySchema, ProductKeywordContextQuerySchema } from './product.validator';

const router = Router();

/**
 * Product Routes
 *
 * GET /products         — product feed
 * GET /products/search  — full-text search
 * GET /products/categories — list unique categories
 * GET /products/:id     — product detail
 *
 * All routes use requireAuth — authentication is mandatory for all endpoints.
 */

router.get(
  '/',
  requireAuth,
  validate(ProductFeedQuerySchema, 'query'),
  ProductController.feed
);

router.get('/all', requireAuth, ProductController.all);

router.get(
  '/search',
  requireAuth,
  validate(ProductSearchQuerySchema, 'query'),
  ProductController.search
);

router.get(
  '/keyword-context',
  requireAuth,
  validate(ProductKeywordContextQuerySchema, 'query'),
  ProductController.keywordContext
);

router.get('/categories', requireAuth, ProductController.categories);
router.get('/saved', requireAuth, ProductController.saved);

// :id must come last — otherwise "search" or "categories" matches as an id
router.get('/:id/creatives', requireAuth, ProductController.creatives);
router.get('/:id', requireAuth, ProductController.detail);

export default router;
