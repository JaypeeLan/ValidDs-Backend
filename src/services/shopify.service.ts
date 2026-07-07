import * as crypto from 'crypto';
import { env } from '../config/env.validation';
import { logger } from '../logger';
import { AppError } from '../middleware/error.middleware';
import { encrypt, decrypt } from '../security/encryption';
import { signJWT, verifyJWT } from '../security/jwt';
import { recordShopifyImport } from './user-activity.service';
import { IShopifyConnection, IUserDocument, User } from '../models/user.model';
import { ShopifyPendingConnection } from '../models/shopify-pending-connection.model';
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

export type ShopifyOAuthStateResult =
  | { purpose: 'shopify_oauth'; userId: string; shop: string; nonce: string }
  | { purpose: 'shopify_oauth_install'; shop: string; nonce: string };

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
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
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
        'SHOPIFY_NOT_CONFIGURED',
      );
    }
  },

  /**
   * Public Shopify signup URL — frontend redirects users here when they don't
   * yet have a Shopify store.
   *
   * When SHOPIFY_SIGNUP_URL is an Impact affiliate link (pxf.io), the referral
   * code is appended as `sub_id` (Impact's tracking parameter).
   * For the standard shopify.com signup, it's appended as `ref`.
   */
  getSignupUrl(): string {
    const base = env.SHOPIFY_SIGNUP_URL;
    if (!env.SHOPIFY_PARTNER_REFERRAL_CODE) return base;
    const sep = base.includes('?') ? '&' : '?';
    const isImpactLink = base.includes('pxf.io') || base.includes('impact.com');
    const param = isImpactLink ? 'sub_id' : 'ref';
    return `${base}${sep}${param}=${encodeURIComponent(env.SHOPIFY_PARTNER_REFERRAL_CODE)}`;
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
        'SHOPIFY_INVALID_SHOP',
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
   * Partner **App URL** entry — starts OAuth without a ValidDs JWT (App Store install check).
   * Token is stored as pending until the user logs in and calls `claimPendingForUser`.
   */
  buildAppInstallAuthUrl(shop: string): { url: string; state: string } {
    this.assertConfigured();

    const normalized = this.normalizeShop(shop);
    const nonce = crypto.randomBytes(16).toString('hex');

    const state = signJWT({
      sub: 'install-pending',
      shop: normalized,
      nonce,
      purpose: 'shopify_oauth_install',
    });

    const params = new URLSearchParams({
      client_id: env.SHOPIFY_API_KEY!,
      scope: env.SHOPIFY_API_SCOPES,
      redirect_uri: env.SHOPIFY_REDIRECT_URI!,
      state,
    });

    const url = `https://${normalized}/admin/oauth/authorize?${params.toString()}`;
    log.info('Shopify App URL OAuth redirect', { shop: normalized });
    return { url, state };
  },

  /**
   * Redirect target after OAuth — goes to the SPA root so the client-side
   * router handles the result. The `/stores/shopify/callback` sub-path only
   * works when navigated to inside the SPA; accessed directly it returns 404
   * on Vercel (no rewrite rule for that path).
   */
  appUiRedirectUrl(query?: {
    status?: string;
    shop?: string;
    code?: string;
    message?: string;
    /** App-URL install without JWT — frontend should call POST /stores/shopify/claim */
    pending?: boolean;
  }): string {
    const origin = (env.FRONTEND_URL ?? '').replace(/\/$/, '');
    const base = `${origin}/`;
    const params = new URLSearchParams();
    if (query?.status) params.set('shopify_status', query.status);
    if (query?.shop) params.set('shop', query.shop);
    if (query?.code) params.set('code', query.code);
    if (query?.message) params.set('message', query.message);
    if (query?.pending) params.set('shopify_pending', '1');
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },

  /** Public API origin (same host as Partner App URL / OAuth callback). */
  publicApiOrigin(): string {
    const uri = env.SHOPIFY_REDIRECT_URI ?? '';
    const match = uri.match(/^(https?:\/\/[^/]+)/i);
    return match?.[1] ?? '';
  },

  /**
   * Post-install landing on the **API host** (`/shopify/connected`).
   * Partner "redirect to app UI" checks follow Application URL domain; we show
   * branded HTML here then forward to the SPA at FRONTEND_URL.
   */
  installConnectedUrl(shop: string): string {
    const origin = this.publicApiOrigin();
    const params = new URLSearchParams({
      shopify_status: 'success',
      shop,
      shopify_pending: '1',
    });
    return `${origin}/shopify/connected?${params.toString()}`;
  },

  buildInstallConnectedPage(shop: string): string {
    const appUrl = this.appUiRedirectUrl({ status: 'success', shop, pending: true });
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ValidDs — Shopify connected</title>
  <meta http-equiv="refresh" content="2;url=${appUrl}" />
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; }
    .card { background: #fff; border-radius: 12px; padding: 48px 40px; max-width: 420px; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 8px; }
    p  { color: #6b7280; margin: 0 0 24px; line-height: 1.5; }
    a  { display: inline-block; background: #111827; color: #fff; text-decoration: none;
         padding: 12px 28px; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Shopify store connected</h1>
    <p>Store <strong>${shop}</strong> is linked. Opening ValidDs&hellip;</p>
    <a href="${appUrl}">Continue to ValidDs</a>
  </div>
</body>
</html>`;
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

  /** Webhook HMAC — base64 digest of raw body (not the hex query-string OAuth HMAC). */
  verifyWebhookHmac(rawBody: Buffer, hmacHeader: string | undefined): boolean {
    this.assertConfigured();
    if (!hmacHeader) return false;

    const computed = crypto
      .createHmac('sha256', env.SHOPIFY_API_SECRET!)
      .update(rawBody)
      .digest('base64');

    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(hmacHeader, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  },

  /**
   * Verify + decode the OAuth `state` parameter (logged-in or App URL install flow).
   */
  verifyOAuthState(state: string, expectedShop: string): ShopifyOAuthStateResult {
    const result = verifyJWT(state);
    if (!result.valid || !result.payload) {
      throw new AppError(
        400,
        result.expired ? 'OAuth state expired — please try again' : 'Invalid OAuth state',
        'SHOPIFY_INVALID_STATE',
      );
    }
    const payload = result.payload as Record<string, unknown>;
    const shop = typeof payload.shop === 'string' ? payload.shop : undefined;
    const nonce = typeof payload.nonce === 'string' ? payload.nonce : undefined;
    if (!shop || !nonce) {
      throw new AppError(400, 'Invalid OAuth state', 'SHOPIFY_INVALID_STATE');
    }
    if (shop !== expectedShop) {
      throw new AppError(400, 'Shop mismatch in OAuth callback', 'SHOPIFY_SHOP_MISMATCH');
    }

    if (payload.purpose === 'shopify_oauth_install') {
      return { purpose: 'shopify_oauth_install', shop, nonce };
    }
    if (payload.purpose === 'shopify_oauth') {
      const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (!userId) throw new AppError(400, 'Invalid OAuth state', 'SHOPIFY_INVALID_STATE');
      return { purpose: 'shopify_oauth', userId, shop, nonce };
    }
    throw new AppError(400, 'Invalid OAuth state', 'SHOPIFY_INVALID_STATE');
  },

  /** @deprecated Use verifyOAuthState — kept for internal callers expecting userId. */
  verifyState(state: string, expectedShop: string): ShopifyOAuthState {
    const parsed = this.verifyOAuthState(state, expectedShop);
    if (parsed.purpose !== 'shopify_oauth') {
      throw new AppError(400, 'Invalid OAuth state', 'SHOPIFY_INVALID_STATE');
    }
    return { userId: parsed.userId, shop: parsed.shop, nonce: parsed.nonce };
  },

  async exchangeCodeForToken(shop: string, code: string): Promise<ShopifyAccessTokenResponse> {
    return this.requestAccessToken(shop, { code, expiring: 1 });
  },

  async requestAccessToken(
    shop: string,
    body: Record<string, string | number>,
  ): Promise<ShopifyAccessTokenResponse> {
    this.assertConfigured();

    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.SHOPIFY_API_KEY,
        client_secret: env.SHOPIFY_API_SECRET,
        ...body,
      }),
    });

    if (!res.ok) {
      const text = await safeReadText(res);
      log.warn('Shopify token request failed', { status: res.status, body: text, shop });
      throw new AppError(
        401,
        'Failed to authenticate with Shopify — please try connecting again',
        'SHOPIFY_TOKEN_EXCHANGE_FAILED',
      );
    }

    const data = (await res.json()) as ShopifyAccessTokenResponse;
    if (!data.access_token) {
      throw new AppError(401, 'Shopify did not return an access token', 'SHOPIFY_TOKEN_MISSING');
    }
    return data;
  },

  applyTokenResponse(connection: IShopifyConnection, tokenRes: ShopifyAccessTokenResponse): void {
    const accessEnc = encrypt(tokenRes.access_token);
    connection.accessTokenCiphertext = accessEnc.data;
    connection.accessTokenIv = accessEnc.iv;
    connection.accessTokenAuthTag = accessEnc.tag;
    connection.scope = tokenRes.scope;

    if (tokenRes.refresh_token) {
      const refreshEnc = encrypt(tokenRes.refresh_token);
      connection.refreshTokenCiphertext = refreshEnc.data;
      connection.refreshTokenIv = refreshEnc.iv;
      connection.refreshTokenAuthTag = refreshEnc.tag;
    }

    if (tokenRes.expires_in) {
      connection.accessTokenExpiresAt = new Date(Date.now() + tokenRes.expires_in * 1000);
    }
    if (tokenRes.refresh_token_expires_in) {
      connection.refreshTokenExpiresAt = new Date(
        Date.now() + tokenRes.refresh_token_expires_in * 1000,
      );
    }
  },

  applyShopInfo(connection: IShopifyConnection, shopInfo: ShopifyShopInfo): void {
    if (shopInfo.name) connection.shopName = shopInfo.name;
    if (shopInfo.email) connection.shopEmail = shopInfo.email;
    if (shopInfo.shop_owner) connection.shopOwner = shopInfo.shop_owner;
    if (shopInfo.country_name) connection.shopCountry = shopInfo.country_name;
    if (shopInfo.currency) connection.shopCurrency = shopInfo.currency;
    connection.lastSyncedAt = new Date();
  },

  /**
   * Migrate legacy non-expiring tokens or refresh expiring ones before Admin API calls.
   */
  async ensureValidAccessToken(
    userId: string,
    connection: IShopifyConnection,
  ): Promise<{ shop: string; accessToken: string; connection: IShopifyConnection }> {
    const shop = connection.shop;
    let accessToken = decrypt({
      data: connection.accessTokenCiphertext,
      iv: connection.accessTokenIv,
      tag: connection.accessTokenAuthTag,
    });

    const needsMigration = !connection.refreshTokenCiphertext;
    const expiresAt = connection.accessTokenExpiresAt?.getTime();
    const expiringSoon = expiresAt != null && expiresAt <= Date.now() + 5 * 60 * 1000;

    if (!needsMigration && !expiringSoon) {
      return { shop, accessToken, connection };
    }

    let tokenRes: ShopifyAccessTokenResponse;

    if (needsMigration) {
      log.info('Migrating Shopify connection to expiring offline token', { userId, shop });
      tokenRes = await this.requestAccessToken(shop, {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: accessToken,
        subject_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        expiring: 1,
      });
    } else {
      const refreshToken = decrypt({
        data: connection.refreshTokenCiphertext!,
        iv: connection.refreshTokenIv!,
        tag: connection.refreshTokenAuthTag!,
      });
      log.info('Refreshing Shopify access token', { userId, shop });
      tokenRes = await this.requestAccessToken(shop, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
    }

    this.applyTokenResponse(connection, tokenRes);
    await User.updateOne({ _id: userId }, { $set: { shopifyConnection: connection } });

    accessToken = tokenRes.access_token;
    return { shop, accessToken, connection };
  },

  /** Backfill owner/country/currency when missing (e.g. after legacy token migration). */
  async refreshConnectionMetadata(userId: string): Promise<IShopifyConnection | null> {
    const user = await User.findById(userId).select('+shopifyConnection');
    const connection = user?.shopifyConnection;
    if (!user || !connection) return null;

    const needsMetadata =
      !connection.shopOwner ||
      !connection.shopCountry ||
      !connection.shopCurrency ||
      !connection.shopEmail;

    if (!needsMetadata) return connection;

    try {
      const {
        shop,
        accessToken,
        connection: conn,
      } = await this.ensureValidAccessToken(userId, connection);
      const shopInfo = await this.fetchShopInfo(shop, accessToken);
      this.applyShopInfo(conn, shopInfo);
      await User.updateOne({ _id: userId }, { $set: { shopifyConnection: conn } });
      return conn;
    } catch (err) {
      log.warn('Failed to refresh Shopify connection metadata', {
        userId,
        shop: connection.shop,
        err: err instanceof Error ? err.message : err,
      });
      return connection;
    }
  },

  /**
   * Fetch basic shop info (name, owner, country, currency) using the freshly
   * issued access token, so we can store a friendly label on the connection.
   *
   * Public Partner apps often reject REST `/shop.json` (403) even after a valid
   * OAuth install — GraphQL `shop` is the supported path for new apps.
   */
  async fetchShopInfo(shop: string, accessToken: string): Promise<ShopifyShopInfo> {
    try {
      return await this.fetchShopInfoGraphql(shop, accessToken);
    } catch (graphqlErr) {
      log.warn('Shopify GraphQL shop info failed, trying REST', {
        shop,
        err: graphqlErr instanceof Error ? graphqlErr.message : graphqlErr,
      });
    }

    try {
      return await this.fetchShopInfoRest(shop, accessToken);
    } catch (restErr) {
      log.warn('Shopify REST shop info failed, using minimal shop metadata', {
        shop,
        err: restErr instanceof Error ? restErr.message : restErr,
      });
      return fallbackShopInfo(shop);
    }
  },

  async fetchShopInfoRest(shop: string, accessToken: string): Promise<ShopifyShopInfo> {
    const res = await this.adminApi<{ shop: ShopifyShopInfo }>(
      shop,
      accessToken,
      'GET',
      '/shop.json',
    );
    return res.shop ?? {};
  },

  async fetchShopInfoGraphql(shop: string, accessToken: string): Promise<ShopifyShopInfo> {
    const query = `
      query ValidDsShopInfo {
        shop {
          name
          email
          currencyCode
          myshopifyDomain
          billingAddress { country countryCodeV2 }
        }
      }
    `;

    const url = `https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (res.status === 401) {
      throw new AppError(
        401,
        'Shopify rejected our access token. Please reconnect your store.',
        'SHOPIFY_AUTH_REVOKED',
      );
    }

    const body = (await res.json()) as {
      data?: {
        shop?: {
          name?: string;
          email?: string;
          currencyCode?: string;
          myshopifyDomain?: string;
          billingAddress?: { country?: string; countryCodeV2?: string };
        };
      };
      errors?: unknown;
    };

    const graphqlError = formatGraphqlErrors(body.errors);
    if (!res.ok || graphqlError) {
      throw new AppError(
        502,
        graphqlError
          ? `Shopify GraphQL error: ${graphqlError}`
          : `Shopify GraphQL error (${res.status})`,
        'SHOPIFY_API_ERROR',
      );
    }

    const shopNode = body.data?.shop;
    if (!shopNode) {
      throw new AppError(502, 'Shopify GraphQL returned no shop data', 'SHOPIFY_API_ERROR');
    }

    const info: ShopifyShopInfo = {
      name: shopNode.name,
      email: shopNode.email,
      currency: shopNode.currencyCode,
      country_name: shopNode.billingAddress?.country ?? shopNode.billingAddress?.countryCodeV2,
      myshopify_domain: shopNode.myshopifyDomain ?? shop,
    };

    // shop_owner lives on REST Shop only (GraphQL accountOwner needs read_users).
    try {
      const rest = await this.fetchShopInfoRest(shop, accessToken);
      if (rest.shop_owner) info.shop_owner = rest.shop_owner;
      if (!info.email && rest.email) info.email = rest.email;
      if (!info.name && rest.name) info.name = rest.name;
    } catch {
      // GraphQL fields are enough for connect; owner is optional.
    }

    return info;
  },

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Encrypt + persist the connection on the user document.
   * Replaces any existing connection (a user has one connected Shopify store).
   */
  async saveConnection(
    userId: string,
    shop: string,
    tokenRes: ShopifyAccessTokenResponse,
    shopInfo: ShopifyShopInfo,
  ): Promise<IShopifyConnection> {
    const connection: IShopifyConnection = {
      shop,
      accessTokenCiphertext: '',
      accessTokenIv: '',
      accessTokenAuthTag: '',
      installedAt: new Date(),
    };

    this.applyTokenResponse(connection, tokenRes);
    this.applyShopInfo(connection, shopInfo);

    await User.updateOne({ _id: userId }, { $set: { shopifyConnection: connection } });

    return connection;
  },

  async savePendingConnection(
    shop: string,
    tokenRes: ShopifyAccessTokenResponse,
    shopInfo: ShopifyShopInfo,
  ): Promise<void> {
    const enc = encrypt(tokenRes.access_token);

    await ShopifyPendingConnection.findOneAndUpdate(
      { shop },
      {
        shop,
        accessTokenCiphertext: enc.data,
        accessTokenIv: enc.iv,
        accessTokenAuthTag: enc.tag,
        scope: tokenRes.scope,
        shopName: shopInfo.name,
        shopEmail: shopInfo.email,
        shopOwner: shopInfo.shop_owner,
        shopCountry: shopInfo.country_name,
        shopCurrency: shopInfo.currency,
        installedAt: new Date(),
      },
      { upsert: true, new: true },
    );
  },

  /** Attach a pending App-URL install to the logged-in ValidDs user. */
  async claimPendingForUser(userId: string, shop: string): Promise<IShopifyConnection> {
    const normalized = this.normalizeShop(shop);
    const pending = await ShopifyPendingConnection.findOne({ shop: normalized });
    if (!pending) {
      throw new AppError(
        404,
        'No pending Shopify connection for this store. Connect from Shopify or try again.',
        'SHOPIFY_PENDING_NOT_FOUND',
      );
    }

    const connection: IShopifyConnection = {
      shop: pending.shop,
      accessTokenCiphertext: pending.accessTokenCiphertext,
      accessTokenIv: pending.accessTokenIv,
      accessTokenAuthTag: pending.accessTokenAuthTag,
      scope: pending.scope,
      shopName: pending.shopName,
      shopEmail: pending.shopEmail,
      shopOwner: pending.shopOwner,
      shopCountry: pending.shopCountry,
      shopCurrency: pending.shopCurrency,
      installedAt: pending.installedAt,
      lastSyncedAt: new Date(),
    };

    await User.updateOne({ _id: userId }, { $set: { shopifyConnection: connection } });
    await ShopifyPendingConnection.deleteOne({ shop: normalized });
    return connection;
  },

  async handleAppUninstalled(shop: string): Promise<void> {
    const normalized = this.normalizeShop(shop);
    await User.updateMany(
      { 'shopifyConnection.shop': normalized },
      { $unset: { shopifyConnection: '' } },
    );
    await ShopifyPendingConnection.deleteOne({ shop: normalized });
    log.info('Shopify app uninstalled — connections cleared', { shop: normalized });
  },

  async disconnect(userId: string): Promise<void> {
    await User.updateOne({ _id: userId }, { $unset: { shopifyConnection: '' } });
  },

  /**
   * Load the connected store for a user, decrypting the access token in memory.
   * Throws 400 if the user has no connected store.
   */
  async getConnection(
    userId: string,
  ): Promise<{ shop: string; accessToken: string; connection: IShopifyConnection }> {
    const user = await User.findById(userId).select('+shopifyConnection');
    if (!user?.shopifyConnection) {
      throw new AppError(
        400,
        'No Shopify store connected. Connect your store first.',
        'SHOPIFY_NOT_CONNECTED',
      );
    }
    return this.ensureValidAccessToken(userId, user.shopifyConnection);
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
    body?: unknown,
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
        'SHOPIFY_AUTH_REVOKED',
      );
    }

    if (!res.ok) {
      const text = await safeReadText(res);
      log.warn('Shopify Admin API error', { status: res.status, path, body: text });
      throw new AppError(
        res.status === 422 ? 422 : 502,
        `Shopify Admin API error (${res.status})`,
        'SHOPIFY_API_ERROR',
        safeParseJson(text),
      );
    }

    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  },

  /**
   * Shopify Admin GraphQL API helper.
   */
  async adminGraphql<T>(
    shop: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401) {
      throw new AppError(
        401,
        'Shopify rejected our access token. Please reconnect your store.',
        'SHOPIFY_AUTH_REVOKED',
      );
    }

    const body = (await res.json()) as { data?: T; errors?: unknown };
    const graphqlError = formatGraphqlErrors(body.errors);
    if (!res.ok || graphqlError) {
      log.warn('Shopify GraphQL request failed', {
        shop,
        status: res.status,
        errors: body.errors,
      });
      throw new AppError(
        502,
        graphqlError
          ? `Shopify GraphQL error: ${graphqlError}`
          : `Shopify GraphQL error (${res.status})`,
        'SHOPIFY_API_ERROR',
      );
    }

    return body.data as T;
  },

  // ── Add item to Shopify store ─────────────────────────────────────────────

  /**
   * Push a ValidDs product to the user's connected Shopify store.
   * Returns the created Shopify product summary (id, handle, admin URL).
   */
  async createProductFromDbProduct(
    user: IUserDocument,
    product: IProductDocument,
    overrides?: { price?: number; status?: 'active' | 'draft' | 'archived' },
  ): Promise<ShopifyProductCreateResult> {
    const { shop, accessToken } = await this.getConnection(String(user._id));

    const shopifyProduct = mapProductToShopify(product, overrides);

    const response = await this.adminApi<{
      product: { id: number; handle: string; status: string };
    }>(shop, accessToken, 'POST', '/products.json', { product: shopifyProduct });

    const created = response.product;

    // Update lastSyncedAt timestamp on the connection
    await User.updateOne(
      { _id: user._id },
      { $set: { 'shopifyConnection.lastSyncedAt': new Date() } },
    );

    recordShopifyImport(String(user._id), String(product._id), {
      shopifyProductId: created.id,
      shop,
    });

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
  overrides?: { price?: number; status?: 'active' | 'draft' | 'archived' },
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

  const variants: ShopifyProductPayload['variants'] = [
    {
      price: price.toFixed(2),
      sku: product.externalId,
      inventory_management: null,
      requires_shipping: true,
      taxable: true,
    },
  ];

  return {
    title: product.title.slice(0, 255),
    body_html: product.description ?? undefined,
    vendor: product.aiIntelligence?.brand ?? product.shopName ?? 'ValidDs',
    product_type: product.categoryL1,
    tags: tags.filter((t, i, arr) => arr.indexOf(t) === i).join(', '),
    status: overrides?.status ?? 'draft',
    images: images.length ? images : undefined,
    variants,
    options: options.length ? options : undefined,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatGraphqlErrors(errors: unknown): string {
  if (!errors) return '';
  if (typeof errors === 'string') return errors;
  if (Array.isArray(errors)) {
    return errors
      .map((e) => (typeof e === 'string' ? e : (e as { message?: string }).message))
      .filter(Boolean)
      .join('; ');
  }
  return String(errors);
}

function fallbackShopInfo(shop: string): ShopifyShopInfo {
  const slug = shop.replace(/\.myshopify\.com$/, '');
  return {
    name: slug.replace(/-/g, ' '),
    myshopify_domain: shop,
  };
}

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
