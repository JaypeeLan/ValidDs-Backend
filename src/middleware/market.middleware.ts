/**
 * Market middleware — attaches market-scoped Mongoose models to every request.
 *
 * Default: `req.user.contentRegion` (set by requireAuth).
 * Dashboard roles may override with `?market=US` (admin creatives / media proxy).
 *
 * Falls back to 'US' if the user has no contentRegion or the value is invalid.
 */

import type { Request, Response, NextFunction } from 'express';
import { getMarketModels, type MarketModels } from '../models/market-models.factory';
import { toMarketCode, type MarketCode } from '../utils/markets';
import { isDashboardRole } from '../utils/roles.util';

export function attachMarketModels(req: Request, _res: Response, next: NextFunction): void {
  // Admins browsing another market (e.g. thumbnail proxy) may pass ?market=US.
  const raw = req.query?.market;
  const queryMarket =
    typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : '';
  const market =
    isDashboardRole(req.user?.role) && queryMarket
      ? toMarketCode(queryMarket)
      : toMarketCode(req.user?.contentRegion);
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
