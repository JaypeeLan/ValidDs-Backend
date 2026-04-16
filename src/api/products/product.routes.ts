import { Router } from 'express';
import { ProductController } from './product.controller';
import { validate } from '../../middleware/validate.middleware';
import { optionalAuth } from '../../middleware/auth.middleware';
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
 * All routes use optionalAuth — authenticated users get plan-aware
 * responses (quota tracking etc.) while anonymous users get basic access.
 */

router.get(
  '/',
  optionalAuth,
  validate(ProductFeedQuerySchema, 'query'),
  ProductController.feed
);

router.get('/all', optionalAuth, ProductController.all);

router.get(
  '/search',
  optionalAuth,
  validate(ProductSearchQuerySchema, 'query'),
  ProductController.search
);

router.get(
  '/keyword-context',
  optionalAuth,
  validate(ProductKeywordContextQuerySchema, 'query'),
  ProductController.keywordContext
);

router.get('/categories', optionalAuth, ProductController.categories);
router.get('/saved', optionalAuth, ProductController.saved);

// :id must come last — otherwise "search" or "categories" matches as an id
router.get('/:id/creatives', optionalAuth, ProductController.creatives);
router.get('/:id', optionalAuth, ProductController.detail);

export default router;
