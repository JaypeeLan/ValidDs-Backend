/**
 * Market middleware — attaches market-scoped Mongoose models to every request.
 *
 * Reads `req.user.contentRegion` (set by requireAuth) and resolves the correct
 * per-market model bundle, so controllers never reference the global singleton
 * models (Product, Creative, LiveSession) directly.
 *
 * Falls back to 'US' if the user has no contentRegion or the value is invalid.
 *
 * Usage on market-scoped routers:
 *   router.use(requireAuth, attachMarketModels);
 *
 * `requireAuth` must run first so `req.user.contentRegion` is loaded from the DB
 * before models are resolved.
 *
 * In controllers:
 *   const { Product } = req.models;
 *   const results = await Product.find(…);
 */

import type { Request, Response, NextFunction } from 'express';
import { getMarketModels, type MarketModels } from '../models/market-models.factory';
import { toMarketCode, type MarketCode } from '../utils/markets';

export function attachMarketModels(req: Request, _res: Response, next: NextFunction): void {
  const market = toMarketCode(req.user?.contentRegion);
  req.market = market;
  req.models = getMarketModels(market);
  next();
}

// ─── Express type augmentation ────────────────────────────────────────────────
// Extends the global Express.Request interface so `req.models` is typed
// everywhere without additional imports.

declare global {
  namespace Express {
    interface Request {
      market: MarketCode;
      models: MarketModels;
    }
  }
}
