import { Router } from 'express';
import { ProductController } from './product.controller';
import { validate } from '../../middleware/validate.middleware';
import { optionalAuth, requireAuth } from '../../middleware/auth.middleware';
import { attachMarketModels } from '../../middleware/market.middleware';
import {
  ProductFeedQuerySchema,
  ProductIdParamSchema,
  ProductKeywordContextQuerySchema,
  ProductRelatedCreativesQuerySchema,
} from './product.validator';

const router = Router();

/**
 * Product Routes
 *
 * GET /products — paginated list or search (public discovery)
 * GET /products/keyword-context — public
 * GET /products/categories — public
 * GET /products/:id — product detail (public)
 * GET /products/:id/related-products — same L2 subcategory products (feed cards)
 * GET /products/:id/similar-products — alias for related-products (feed cards)
 * GET /products/:id/related-videos — commercial (non-ad) creatives for this product
 * GET /products/:id/related-ads — paid / top-ad creatives for this product
 * GET /products/saved — requires JWT (user bookmarks)
 */

// optionalAuth loads the user from DB so contentRegion is available before market models attach.
router.use(optionalAuth, attachMarketModels);

router.get('/', validate(ProductFeedQuerySchema, 'query'), ProductController.feed);

router.get(
  '/keyword-context',
  validate(ProductKeywordContextQuerySchema, 'query'),
  ProductController.keywordContext,
);

router.get('/categories', ProductController.categories);
router.get('/subcategories', ProductController.subcategories);
router.get('/taxonomy', ProductController.taxonomy);
router.get('/saved', requireAuth, ProductController.saved);

router.get(
  '/:id/related-products',
  validate(ProductIdParamSchema, 'params'),
  ProductController.relatedProducts,
);
router.get(
  '/:id/similar-products',
  validate(ProductIdParamSchema, 'params'),
  ProductController.relatedProducts,
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
