import * as crypto from 'crypto';
import { env } from '../config/env.validation';
import { logger } from '../logger';
import { AppError } from '../middleware/error.middleware';
import { encrypt, decrypt } from '../security/encryption';
import { signJWT, verifyJWT } from '../security/jwt';
import {
  IShopifyConnection,
  IUserDocument,
  User,
} from '../models/user.model';
import { IProductDocument } from '../models/product.model';

const log = logger.child({ module: 'shopify-service' });

/**
 * Shopify Service
 *
 * Implements the standard Shopify "Public/Custom App" OAuth flow:
 *
 *  1. Frontend hits   GET  /api/v1/stores/shopify/install?shop=<shop>
 *     → backend returns an authorize URL that the user is redirected to.
 *     If the user does NOT yet have a Shopify store (no `shop` query),
 *     the controller instead returns the SHOPIFY_SIGNUP_URL.
 *
 *  2. Shopify redirects back to GET /api/v1/stores/shopify/callback
 *     with ?code=&hmac=&shop=&state=...
 *     → backend verifies HMAC + state, exchanges code for access token,
 *       stores the encrypted token on the user document.
 *
 *  3. Authenticated users can call POST /api/v1/stores/shopify/products
 *     with { productId } to push a ValidDs product to their connected store.
 *
 * The access token is encrypted with AES-256-GCM using ENCRYPTION_KEY before
 * persisting (see security/encryption.ts). It is never returned over the API.
 *
 * No external Shopify SDK is used — all interactions go through the standard
 * Admin REST API (`/admin/api/<version>/`). This keeps zero new dependencies.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShopifyOAuthState {
  userId: string;
  shop: string;
  nonce: string;
}

export interface ShopifyShopInfo {
  id?: number;
  name?: string;
  email?: string;
  domain?: string;
  shop_owner?: string;
  country_name?: string;
  currency?: string;
  myshopify_domain?: string;
}

export interface ShopifyProductCreateResult {
  id: number;
  handle: string;
  status: string;
  adminUrl: string;
  storefrontUrl: string;
}

interface ShopifyAccessTokenResponse {
  access_token: string;
  scope: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const ShopifyService = {

  // ── Config / readiness ────────────────────────────────────────────────────

  isConfigured(): boolean {
    return Boolean(env.SHOPIFY_API_KEY && env.SHOPIFY_API_SECRET && env.SHOPIFY_REDIRECT_URI);
  },

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError(
        503,
        'Shopify integration is not configured on this server',
        'SHOPIFY_NOT_CONFIGURED'
      );
    }
  },

  /**
   * Public Shopify signup URL — frontend redirects users here when they don't
   * yet have a Shopify store. If SHOPIFY_PARTNER_REFERRAL_CODE is set, it is
   * appended for partner attribution.
   */
  getSignupUrl(): string {
    const base = env.SHOPIFY_SIGNUP_URL;
    if (!env.SHOPIFY_PARTNER_REFERRAL_CODE) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}ref=${encodeURIComponent(env.SHOPIFY_PARTNER_REFERRAL_CODE)}`;
  },

  // ── OAuth ─────────────────────────────────────────────────────────────────

  /**
   * Normalise a user-supplied shop string into the canonical `<name>.myshopify.com`
   * form. Throws if it doesn't look like a valid Shopify shop identifier.
   *
   * Accepts:
   *   "my-store"
   *   "my-store.myshopify.com"
   *   "https://my-store.myshopify.com"
   *   "https://my-store.myshopify.com/admin"
   */
  normalizeShop(input: string): string {
    if (!input || typeof input !== 'string') {
      throw new AppError(400, 'Shop is required', 'SHOPIFY_INVALID_SHOP');
    }

    let shop = input.trim().toLowerCase();
    shop = shop.replace(/^https?:\/\//, '');
    shop = shop.replace(/\/.*$/, '');

    if (!shop.includes('.')) {
      shop = `${shop}.myshopify.com`;
    }

    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      throw new AppError(
        400,
        'Shop must be a valid <name>.myshopify.com domain',
        'SHOPIFY_INVALID_SHOP'
      );
    }

    return shop;
  },

  /**
   * Build the Shopify OAuth authorize URL.
   * The `state` is a short-lived signed JWT containing { userId, shop, nonce }
   * so we don't need any extra storage for CSRF protection.
   */
  buildAuthUrl(shop: string, userId: string): { url: string; state: string } {
    this.assertConfigured();

    const normalized = this.normalizeShop(shop);
    const nonce = crypto.randomBytes(16).toString('hex');

    const state = signJWT({
      sub: userId,
      shop: normalized,
      nonce,
      purpose: 'shopify_oauth',
    });

    const params = new URLSearchParams({
      client_id: env.SHOPIFY_API_KEY!,
      scope: env.SHOPIFY_API_SCOPES,
      redirect_uri: env.SHOPIFY_REDIRECT_URI!,
      state,
    });

    const url = `https://${normalized}/admin/oauth/authorize?${params.toString()}`;
    log.info('Shopify OAuth URL built', { url, redirect_uri: env.SHOPIFY_REDIRECT_URI });
    return { url, state };
  },

  /**
   * Verify Shopify's HMAC signature on incoming OAuth callback query params.
   * Per Shopify docs: build a query string from all params EXCEPT `hmac` and
   * `signature`, sorted by key, then HMAC-SHA256 with the API secret.
   */
  verifyHmac(query: Record<string, string | string[] | undefined>): boolean {
    this.assertConfigured();

    const hmac = typeof query.hmac === 'string' ? query.hmac : undefined;
    if (!hmac) return false;

    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key === 'hmac' || key === 'signature') continue;
      if (value === undefined) continue;
      filtered[key] = Array.isArray(value) ? value.join(',') : String(value);
    }

    const message = Object.keys(filtered)
      .sort()
      .map((k) => `${k}=${filtered[k]}`)
      .join('&');

    const computed = crypto
      .createHmac('sha256', env.SHOPIFY_API_SECRET!)
      .update(message)
      .digest('hex');

    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(hmac, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  /**
   * Verify + decode the OAuth `state` parameter. Returns the original userId
   * + shop, or throws if anything is off.
   */
  verifyState(state: string, expectedShop: string): ShopifyOAuthState {
    const result = verifyJWT(state);
    if (!result.valid || !result.payload) {
      throw new AppError(
        400,
        result.expired ? 'OAuth state expired — please try again' : 'Invalid OAuth state',
        'SHOPIFY_INVALID_STATE'
      );
    }
    const payload = result.payload as Record<string, unknown>;
    if (payload.purpose !== 'shopify_oauth') {
      throw new AppError(400, 'Invalid OAuth state', 'SHOPIFY_INVALID_STATE');
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
    const shop = typeof payload.shop === 'string' ? payload.shop : undefined;
    const nonce = typeof payload.nonce === 'string' ? payload.nonce : undefined;
    if (!userId || !shop || !nonce) {
      throw new AppError(400, 'Invalid OAuth state', 'SHOPIFY_INVALID_STATE');
    }
    if (shop !== expectedShop) {
      throw new AppError(400, 'Shop mismatch in OAuth callback', 'SHOPIFY_SHOP_MISMATCH');
    }
    return { userId, shop, nonce };
  },

  /**
   * Exchange the authorization code for a permanent Admin API access token.
   * Shopify endpoint: POST https://<shop>/admin/oauth/access_token
   */
  async exchangeCodeForToken(shop: string, code: string): Promise<ShopifyAccessTokenResponse> {
    this.assertConfigured();

    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    if (!res.ok) {
      const body = await safeReadText(res);
      log.warn('Shopify token exchange failed', { status: res.status, body });
      throw new AppError(
        401,
        'Failed to authenticate with Shopify — please try connecting again',
        'SHOPIFY_TOKEN_EXCHANGE_FAILED'
      );
    }

    const data = (await res.json()) as ShopifyAccessTokenResponse;
    if (!data.access_token) {
      throw new AppError(401, 'Shopify did not return an access token', 'SHOPIFY_TOKEN_MISSING');
    }
    return data;
  },

  /**
   * Fetch basic shop info (name, owner, country, currency) using the freshly
   * issued access token, so we can store a friendly label on the connection.
   */
  async fetchShopInfo(shop: string, accessToken: string): Promise<ShopifyShopInfo> {
    const res = await this.adminApi<{ shop: ShopifyShopInfo }>(
      shop,
      accessToken,
      'GET',
      '/shop.json'
    );
    return res.shop ?? {};
  },

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Encrypt + persist the connection on the user document.
   * Replaces any existing connection (a user has one connected Shopify store).
   */
  async saveConnection(
    userId: string,
    shop: string,
    accessToken: string,
    scope: string,
    shopInfo: ShopifyShopInfo
  ): Promise<IShopifyConnection> {
    const enc = encrypt(accessToken);

    const connection: IShopifyConnection = {
      shop,
      accessTokenCiphertext: enc.data,
      accessTokenIv: enc.iv,
      accessTokenAuthTag: enc.tag,
      scope,
      shopName: shopInfo.name,
      shopEmail: shopInfo.email,
      shopOwner: shopInfo.shop_owner,
      shopCountry: shopInfo.country_name,
      shopCurrency: shopInfo.currency,
      installedAt: new Date(),
      lastSyncedAt: new Date(),
    };

    await User.updateOne(
      { _id: userId },
      { $set: { shopifyConnection: connection } }
    );

    return connection;
  },

  async disconnect(userId: string): Promise<void> {
    await User.updateOne(
      { _id: userId },
      { $unset: { shopifyConnection: '' } }
    );
  },

  /**
   * Load the connected store for a user, decrypting the access token in memory.
   * Throws 400 if the user has no connected store.
   */
  async getConnection(
    userId: string
  ): Promise<{ shop: string; accessToken: string; connection: IShopifyConnection }> {
    const user = await User.findById(userId).select('+shopifyConnection');
    if (!user?.shopifyConnection) {
      throw new AppError(
        400,
        'No Shopify store connected. Connect your store first.',
        'SHOPIFY_NOT_CONNECTED'
      );
    }
    const c = user.shopifyConnection;
    const accessToken = decrypt({
      data: c.accessTokenCiphertext,
      iv: c.accessTokenIv,
      tag: c.accessTokenAuthTag,
    });
    return { shop: c.shop, accessToken, connection: c };
  },

  /**
   * Public view of the connection — safe to return over the API
   * (never includes the access token).
   */
  publicConnectionView(connection: IShopifyConnection | undefined | null) {
    if (!connection) return null;
    return {
      shop: connection.shop,
      shopName: connection.shopName ?? null,
      shopEmail: connection.shopEmail ?? null,
      shopOwner: connection.shopOwner ?? null,
      shopCountry: connection.shopCountry ?? null,
      shopCurrency: connection.shopCurrency ?? null,
      scope: connection.scope ?? null,
      installedAt: connection.installedAt,
      lastSyncedAt: connection.lastSyncedAt ?? null,
      adminUrl: `https://${connection.shop}/admin`,
    };
  },

  // ── Admin API helpers ─────────────────────────────────────────────────────

  /**
   * Thin wrapper around fetch for the Shopify Admin REST API.
   * Handles auth header, JSON parsing, error mapping.
   */
  async adminApi<T>(
    shop: string,
    accessToken: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      throw new AppError(
        401,
        'Shopify rejected our access token. Please reconnect your store.',
        'SHOPIFY_AUTH_REVOKED'
      );
    }

    if (!res.ok) {
      const text = await safeReadText(res);
      log.warn('Shopify Admin API error', { status: res.status, path, body: text });
      throw new AppError(
        res.status === 422 ? 422 : 502,
        `Shopify Admin API error (${res.status})`,
        'SHOPIFY_API_ERROR',
        safeParseJson(text)
      );
    }

    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  },

  // ── Add item to Shopify store ─────────────────────────────────────────────

  /**
   * Push a ValidDs product to the user's connected Shopify store.
   * Returns the created Shopify product summary (id, handle, admin URL).
   */
  async createProductFromDbProduct(
    user: IUserDocument,
    product: IProductDocument,
    overrides?: { price?: number; status?: 'active' | 'draft' | 'archived' }
  ): Promise<ShopifyProductCreateResult> {
    const { shop, accessToken } = await this.getConnection(String(user._id));

    const shopifyProduct = mapProductToShopify(product, overrides);

    const response = await this.adminApi<{ product: { id: number; handle: string; status: string } }>(
      shop,
      accessToken,
      'POST',
      '/products.json',
      { product: shopifyProduct }
    );

    const created = response.product;

    // Update lastSyncedAt timestamp on the connection
    await User.updateOne(
      { _id: user._id },
      { $set: { 'shopifyConnection.lastSyncedAt': new Date() } }
    );

    log.info('Created Shopify product', {
      userId: String(user._id),
      shop,
      productId: String(product._id),
      shopifyProductId: created.id,
    });

    return {
      id: created.id,
      handle: created.handle,
      status: created.status,
      adminUrl: `https://${shop}/admin/products/${created.id}`,
      storefrontUrl: `https://${shop.replace('.myshopify.com', '')}.myshopify.com/products/${created.handle}`,
    };
  },
};

// ── Mapping: ValidDs Product → Shopify Product ───────────────────────────────

interface ShopifyProductPayload {
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: 'active' | 'draft' | 'archived';
  images?: Array<{ src: string }>;
  options?: Array<{ name: string; values: string[] }>;
}

function mapProductToShopify(
  product: IProductDocument,
  overrides?: { price?: number; status?: 'active' | 'draft' | 'archived' }
): ShopifyProductPayload {
  const price = overrides?.price ?? product.price ?? 0;
  // const compareAt = product.originalPrice && product.originalPrice > price
  //   ? product.originalPrice
  //   : undefined;

  const images: Array<{ src: string }> = [];
  if (product.primaryImageUrl) images.push({ src: product.primaryImageUrl });
  for (const url of product.imageUrls ?? []) {
    if (url && url !== product.primaryImageUrl) images.push({ src: url });
  }

  const tags: string[] = [];
  if (product.categoryL1) tags.push(product.categoryL1);
  if (product.categoryL2) tags.push(product.categoryL2);
  if (product.aiIntelligence?.niche) tags.push(product.aiIntelligence.niche);
  for (const t of product.hashtags ?? []) tags.push(t);


  const options: ShopifyProductPayload['options'] = [];

  // const variants: ShopifyProductPayload['variants'] = [{
  //   price: price.toFixed(2),
  //   ...(compareAt ? { compare_at_price: compareAt.toFixed(2) } : {}),
  //   sku: product.externalId,
  //   inventory_management: null,
  //   requires_shipping: true,
  //   taxable: true,
  // }];

  return {
    title: product.title.slice(0, 255),
    body_html: product.description ?? undefined,
    vendor: product.aiIntelligence?.brand ?? product.shopName ?? 'ValidDs',
    product_type: product.categoryL1,
    tags: tags.filter((t, i, arr) => arr.indexOf(t) === i).join(', '),
    status: overrides?.status ?? 'draft',
    images: images.length ? images : undefined,
    // variants,
    options: options.length ? options : undefined,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function safeParseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
