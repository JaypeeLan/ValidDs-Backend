import { Router } from 'express';
import { ProductController } from './product.controller';
import { validate } from '../../middleware/validate.middleware';
import { requireAuth } from '../../middleware/auth.middleware';
import { attachMarketModels } from '../../middleware/market.middleware';
import { ProductFeedQuerySchema, ProductKeywordContextQuerySchema } from './product.validator';

const router = Router();

/**
 * Product Routes
 *
 * GET /products — paginated list or search (public discovery)
 * GET /products/keyword-context — public
 * GET /products/categories — public
 * GET /products/:id — product detail (public)
 * GET /products/saved — requires JWT (user bookmarks)
 */

// attachMarketModels reads req.user?.contentRegion and sets req.models.
// For authenticated users it picks their selected region; for public requests it defaults to US.
router.use(attachMarketModels);

router.get(
  '/',
  validate(ProductFeedQuerySchema, 'query'),
  ProductController.feed
);

router.get(
  '/keyword-context',
  validate(ProductKeywordContextQuerySchema, 'query'),
  ProductController.keywordContext
);

router.get('/categories',    ProductController.categories);
router.get('/subcategories', ProductController.subcategories);
router.get('/taxonomy',      ProductController.taxonomy);
router.get('/saved', requireAuth, ProductController.saved);

// :id must come last — otherwise static segments like "categories" match as an id
router.get('/:id', ProductController.detail);

export default router;
