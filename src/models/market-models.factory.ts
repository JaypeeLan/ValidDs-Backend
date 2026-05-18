/**
 * Market-scoped model factory.
 *
 * Each market (US, UK, CA, …) stores its content in dedicated MongoDB collections:
 *   products_us, creatives_us, live_sessions_us
 *   products_uk, creatives_uk, live_sessions_uk  … etc.
 *
 * This avoids multi-million-document cross-country scans at query time: every
 * query already lands in the right namespace with no runtime `{ market }` filter.
 *
 * Usage:
 *   const { Product, Creative, LiveSession } = getMarketModels('US');
 *   await Product.find({ status: 'active' }).limit(20);
 *
 * Models are cached after first creation — Mongoose throws if you register the
 * same model name twice, so we guard with `mongoose.modelNames()`.
 */

import mongoose from 'mongoose';
import type { Model } from 'mongoose';
import { ProductSchema } from './product.model';
import { CreativeSchema } from './creative.model';
import { LiveSessionSchema, type ILiveSessionDocument, type ILiveSessionModel } from './live-session.model';
import type { IProductDocument, IProductModel } from '../types/product.types';
import type { ICreativeDocument } from '../types/creative.types';
import { marketCollection, type MarketCode } from '../utils/markets';

// ── Per-market model bundle ───────────────────────────────────────────────────

export interface MarketModels {
  Product:     IProductModel;
  Creative:    Model<ICreativeDocument>;
  LiveSession: ILiveSessionModel;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const _cache = new Map<MarketCode, MarketModels>();

// ── Internal helper ───────────────────────────────────────────────────────────

function getOrCreate<TDoc, TModel extends Model<TDoc>>(
  name: string,
  schema: mongoose.Schema,
  collection: string,
): TModel {
  if (mongoose.modelNames().includes(name)) {
    return mongoose.model<TDoc, TModel>(name);
  }
  return mongoose.model<TDoc, TModel>(name, schema, collection);
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function getMarketModels(market: MarketCode): MarketModels {
  const cached = _cache.get(market);
  if (cached) return cached;

  const Product = getOrCreate<IProductDocument, IProductModel>(
    `Product_${market}`,
    ProductSchema.clone(),
    marketCollection('products', market),
  );

  const Creative = getOrCreate<ICreativeDocument, Model<ICreativeDocument>>(
    `Creative_${market}`,
    CreativeSchema.clone(),
    marketCollection('creatives', market),
  );

  const LiveSession = getOrCreate<ILiveSessionDocument, ILiveSessionModel>(
    `LiveSession_${market}`,
    LiveSessionSchema.clone(),
    marketCollection('live_sessions', market),
  );

  const models: MarketModels = { Product, Creative, LiveSession };
  _cache.set(market, models);
  return models;
}

/** Convenience: return just the Product model for a given market. */
export function getMarketProduct(market: MarketCode): IProductModel {
  return getMarketModels(market).Product;
}
