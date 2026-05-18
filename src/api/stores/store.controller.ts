import { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.validation';
import { AppError } from '../../middleware/error.middleware';
import { logger } from '../../logger';
import { ResponseMessage, successResponse } from '../../utils/response.util';
import { User } from '../../models/user.model';
import { getMarketModels } from '../../models/market-models.factory';
import { toMarketCode } from '../../utils/markets';
import { ShopifyService } from '../../services/shopify.service';
import {
  ShopifyAddProductInput,
  ShopifyCallbackQuery,
  ShopifyInstallQuery,
} from './store.validator';

const log = logger.child({ module: 'store-controller' });

/**
 * Store Controller — Shopify integration
 *
 *  GET   /api/v1/stores/shopify/install   → Start OAuth (or return signup URL)
 *  GET   /api/v1/stores/shopify/callback  → OAuth callback (browser redirect)
 *  GET   /api/v1/stores/shopify/status    → Is the user's store connected?
 *  POST  /api/v1/stores/shopify/disconnect → Disconnect the store
 *  POST  /api/v1/stores/shopify/products  → Push a ValidDs product to Shopify
 */
export const StoreController = {

  /**
   * GET /api/v1/stores/shopify/install
   *
   * Body/query: { shop?: string }
   *
   *  - If a `shop` is provided → returns a Shopify OAuth URL the frontend
   *    must redirect the user to (so they can authorise our app).
   *
   *  - If no `shop` is provided → assume the user does NOT yet have a Shopify
   *    account and return the public Shopify signup URL instead so the
   *    frontend can redirect them there.
   */
  install(req: Request, res: Response, next: NextFunction): void {
    try {
      const query = req.query as unknown as ShopifyInstallQuery;
      const user = req.user!;

      if (!query.shop) {
        const signupUrl = ShopifyService.getSignupUrl();
        res.json(
          successResponse(
            {
              action: 'signup' as const,
              signupUrl,
              message:
                "It looks like you don't have a Shopify store yet. Create one first, then come back and connect it.",
            },
            ResponseMessage.SUCCESS,
            200
          )
        );
        return;
      }

      ShopifyService.assertConfigured();
      const { url, state } = ShopifyService.buildAuthUrl(query.shop, String(user._id));

      res.json(
        successResponse(
          {
            action: 'connect' as const,
            authorizeUrl: url,
            state,
          },
          ResponseMessage.SUCCESS,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/stores/shopify/callback
   *
   * Shopify redirects the browser here with ?code=&hmac=&shop=&state=...
   *
   * Flow:
   *  1. Validate HMAC + state (the state carries the userId).
   *  2. Exchange the code for a permanent access token.
   *  3. Fetch basic shop info.
   *  4. Persist (encrypted) on the user document.
   *  5. Redirect the browser to FRONTEND_URL/stores/shopify/callback?status=...
   */
  async callback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as unknown as ShopifyCallbackQuery;
      ShopifyService.assertConfigured();

      const shop = ShopifyService.normalizeShop(query.shop);

      if (!ShopifyService.verifyHmac(req.query as Record<string, string | string[] | undefined>)) {
        throw new AppError(400, 'Invalid HMAC on Shopify callback', 'SHOPIFY_INVALID_HMAC');
      }

      const state = ShopifyService.verifyState(query.state, shop);

      const tokenRes = await ShopifyService.exchangeCodeForToken(shop, query.code);
      const shopInfo = await ShopifyService.fetchShopInfo(shop, tokenRes.access_token);
      await ShopifyService.saveConnection(
        state.userId,
        shop,
        tokenRes.access_token,
        tokenRes.scope,
        shopInfo
      );

      log.info('Shopify store connected', { userId: state.userId, shop });

      const frontendBase = env.FRONTEND_URL;
      const target =
        `${frontendBase}/stores/shopify/callback` +
        `?status=success&shop=${encodeURIComponent(shop)}`;
      res.redirect(target);
    } catch (err) {
      // If anything goes wrong, redirect the user back to the frontend with
      // an error indicator instead of dumping a stack trace in the browser.
      const message =
        err instanceof AppError ? err.message : 'Shopify connection failed';
      const code = err instanceof AppError ? err.code ?? 'SHOPIFY_ERROR' : 'SHOPIFY_ERROR';
      log.warn('Shopify callback failed', { message, code });
      try {
        const frontendBase = env.FRONTEND_URL;
        res.redirect(
          // `${frontendBase}/stores/shopify/callback?status=error&code=${encodeURIComponent(code)}&message=${encodeURIComponent(message)}`
          `${frontendBase}`
        );
      } catch {
        next(err);
      }
    }
  },

  /**
   * GET /api/v1/stores/shopify/status
   * Returns whether the current user has a Shopify store connected.
   */
  async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // shopifyConnection is select:false by default — re-query with it included.
      const userWithConn = await User.findById(req.user!._id).select('+shopifyConnection');
      const conn = userWithConn?.shopifyConnection;
      res.json(
        successResponse(
          {
            connected: Boolean(conn),
            shopifyConfigured: ShopifyService.isConfigured(),
            connection: ShopifyService.publicConnectionView(conn),
          },
          ResponseMessage.SUCCESS,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/stores/shopify/disconnect
   * Removes the Shopify connection from the user's account.
   * NOTE: This does NOT uninstall the app on Shopify's side — the user
   * must do that from their Shopify admin for full revocation.
   */
  async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await ShopifyService.disconnect(String(req.user!._id));
      log.info('Shopify store disconnected', { userId: req.user!.id });
      res.json(
        successResponse(
          { disconnected: true },
          ResponseMessage.SHOPIFY_DISCONNECTED,
          200
        )
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/stores/shopify/products
   *
   * Body: { productId, price?, status? }
   *
   * Pushes the specified ValidDs product to the user's connected Shopify store.
   * Returns the created Shopify product (id, handle, admin URL).
   */
  async addProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = req.body as ShopifyAddProductInput;
      const user = req.user!;

      // Products live in per-market collections (products_us, …) — same as GET /products.
      const market = toMarketCode(input.market ?? user.contentRegion);
      const { Product: MarketProduct } = getMarketModels(market);
      const product = await MarketProduct.findById(input.productId);
      if (!product) {
        throw new AppError(
          404,
          `Product not found in market ${market}`,
          'PRODUCT_NOT_FOUND',
        );
      }

      const created = await ShopifyService.createProductFromDbProduct(user, product, {
        price: input.price,
        status: input.status,
      });

      res.status(201).json(
        successResponse(
          { product: created },
          ResponseMessage.SHOPIFY_PRODUCT_PUSHED,
          201
        )
      );
    } catch (err) {
      next(err);
    }
  },
};
