import { Request, Response, NextFunction, Router } from 'express';
import { runShopifyScraper } from '../../services/apify.service';
import { ShopifyScraperResponseData } from '../../services/apify.types';
import { successResponse } from '../../utils/response.util';
import { AppError } from '../../middleware/error.middleware';
import { requireApiKey } from '../../middleware/auth.middleware';

const router = Router();

router.post('/get-product-name', requireApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productName } = req.body as { productName?: string };

    if (!productName || !productName.trim()) {
      throw new AppError(400, 'productName is required', 'VALIDATION_ERROR');
    }

    const data = await runShopifyScraper(productName.trim());
    const payload: ShopifyScraperResponseData = { count: data.length, data };
    res.json(successResponse(payload, 'Shopify scrape completed successfully.', 200));
  } catch (err) {
    next(err);
  }
});

export default router;
