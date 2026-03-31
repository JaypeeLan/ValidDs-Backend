import { Request, Response, NextFunction } from 'express';
import { ProductService } from '../../services/product.service';
import { ProductFeedQuery, ProductSearchQuery } from './product.validator';
import { ResponseMessage, successResponse } from '../../utils/response.util';

/**
 * Product Controller
 *
 * GET /api/v1/products         — product feed (paginated, filtered)
 * GET /api/v1/products/search  — full-text search
 * GET /api/v1/products/:id     — product detail
 */

export const ProductController = {

  async feed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ProductFeedQuery;
      
      if (!query.region) {
        // Try getting region from authenticated user profile
        if (req.user) {
          const locale = (req.user as any).locale;
          if (locale && locale.includes('-')) {
            query.region = locale.split('-')[1].toUpperCase();
          } else {
            query.region = 'US';
          }
        } else {
          query.region = 'US';
        }
      }
      
      const { feed, freshness } = await ProductService.getFeed(query);

      res.json(
        successResponse(
          {
            products: feed.data,
            pagination: feed.pagination,
            freshness,
            region: query.region,
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { q, page, limit } = req.query as unknown as ProductSearchQuery;
      const results = await ProductService.search(q, page, limit);

      res.json(
        successResponse(
          {
            products: results.data,
            pagination: results.pagination,
          },
          ResponseMessage.PRODUCTS_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { product, freshness } = await ProductService.getById(id);

      res.json(
        successResponse(
          { product, freshness },
          ResponseMessage.PRODUCT_RETRIEVED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
