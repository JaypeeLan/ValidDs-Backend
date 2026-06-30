import { Router } from 'express';
import { ProductController } from './product.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { attachMarketModels } from '../../middleware/market.middleware';
import {
  ProductCompareQuerySchema,
  ProductFeedQuerySchema,
  ProductForYouQuerySchema,
  ProductIdParamSchema,
  ProductKeywordContextQuerySchema,
  ProductRelatedCreativesQuerySchema,
  ProductYouMayLikeQuerySchema,
} from './product.validator';

const router = Router();

/**
 * Product Routes
 *
 * GET /products — paginated list or search (JWT required)
 * GET /products/keyword-context — JWT required
 * GET /products/categories — JWT required
 * GET /products/:id — product detail (JWT required)
 * GET /products/:id/related-products — L2-narrowed, L3-matched when present (feed cards)
 * GET /products/:id/related-videos — commercial (non-ad) creatives for this product
 * GET /products/:id/related-ads — paid / top-ad creatives for this product
 * GET /products/saved — requires JWT (user bookmarks)
 * GET /products/compare — AI comparison + basic info for 2–5 products
 */

router.use(requireAuth, attachMarketModels);

router.get('/', validate(ProductFeedQuerySchema, 'query'), ProductController.feed);

router.get(
  '/keyword-context',
  validate(ProductKeywordContextQuerySchema, 'query'),
  ProductController.keywordContext,
);

router.get('/categories', ProductController.categories);
router.get('/subcategories', ProductController.subcategories);
router.get('/taxonomy', ProductController.taxonomy);
router.get('/saved', ProductController.saved);
router.get('/for-you', validate(ProductForYouQuerySchema, 'query'), ProductController.forYou);

router.get('/compare', validate(ProductCompareQuerySchema, 'query'), ProductController.compare);

router.get(
  '/:id/related-products',
  validate(ProductIdParamSchema, 'params'),
  ProductController.relatedProducts,
);
router.get(
  '/:id/you-may-like',
  validate(ProductIdParamSchema, 'params'),
  validate(ProductYouMayLikeQuerySchema, 'query'),
  ProductController.youMayLike,
);
router.get(
  '/:id/related-videos',
  validate(ProductIdParamSchema, 'params'),
  validate(ProductRelatedCreativesQuerySchema, 'query'),
  ProductController.relatedVideos,
);
router.get(
  '/:id/related-ads',
  validate(ProductIdParamSchema, 'params'),
  validate(ProductRelatedCreativesQuerySchema, 'query'),
  ProductController.relatedAds,
);

router.get('/:id', validate(ProductIdParamSchema, 'params'), ProductController.detail);

export default router;
