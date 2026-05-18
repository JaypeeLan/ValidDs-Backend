/**
 * Market middleware — attaches market-scoped Mongoose models to every request.
 *
 * Reads `req.user.contentRegion` (set by requireAuth) and resolves the correct
 * per-market model bundle, so controllers never reference the global singleton
 * models (Product, Creative, LiveSession) directly.
 *
 * Falls back to 'US' if the user has no contentRegion or the value is invalid.
 *
 * Usage (apply after requireAuth in route files):
 *   router.use(requireAuth, attachMarketModels);
 *   router.get('/feed', ProductController.getFeed);
 *
 * In controllers:
 *   const { Product } = req.models;
 *   const results = await Product.find(…);
 */

import type { Request, Response, NextFunction } from 'express';
import { getMarketModels, type MarketModels } from '../models/market-models.factory';
import { toMarketCode } from '../utils/markets';

export function attachMarketModels(req: Request, _res: Response, next: NextFunction): void {
  const market = toMarketCode(req.user?.contentRegion);
  req.models = getMarketModels(market);
  next();
}

// ─── Express type augmentation ────────────────────────────────────────────────
// Extends the global Express.Request interface so `req.models` is typed
// everywhere without additional imports.

declare global {
  namespace Express {
    interface Request {
      models: MarketModels;
    }
  }
}
