# ValidDs Backend — Endpoint Documentation

This document explicitly details the core REST API endpoints available within the ValidDs V1 application. It outlines the required request shapes and returned responses.

All endpoints return standardized success envelopes detailed in `docs/api-responses.md`. Base URL path for all endpoints is `/api/v1`.

---

## 1. Product Endpoints

### `GET /products`
Returns a paginated list of products (full catalog by page). Supports optional full-text search and filters on the **same** route.
**Authentication:** Not required (optional JWT improves default `region` when logged in).
**Query Parameters:**
- `page` *(number, optional)*: Page number (defaults to 1).
- `limit` *(number, optional)*: Items per page (defaults to 20, max 100).
- `q` *(string, optional)*: When set, runs MongoDB text search on titles/descriptions; results ordered by relevance (`sortBy` is ignored).
- `category` *(string, optional)*: Filter by canonical category. Accepts a single string or comma-separated list.
- `niche` *(string, optional)*: Filter by specific sub-niche string.
- `trendDirection` *(string, optional)*: Filter by direction. Accepts `rising`, `peaked`, `saturating`, `unknown`.
- `minTrendScore` *(number, optional)*: Filter items above a given trend momentum score (0-100).
- `minViews` *(number, optional)*: Filter out products whose primary video has less than this amount of views.
- `section` *(string, optional)*: Require a discovery section slug on the product (e.g. `top-ads`, `trending`, `viral`). See OpenAPI enum.
- `isAd` *(boolean, optional)*: When `true`, same as the `top-ads` discovery bucket (`discoverySections` contains `top-ads`). When `false`, excludes that bucket.
- `sortBy` *(string, optional)*: `trendScore` (default), `views`, `recent`, `engagement` (ignored when `q` is set).
- `region` *(string, optional)*: Echoed in the response; defaults from the user profile when omitted.

### `GET /products/:id`
Returns comprehensive data for a single product.
**Authentication:** Not required.
**Path Parameters:** `id` (MongoDB ObjectId).

### `GET /products/categories`
Returns a highly distinct array of existing categories.
**Authentication:** Not required.

---

## 2. Authentication Endpoints (`/auth`)

### `POST /auth/register`
Local email and password registration.
**Body:** `{ "email": "...", "password": "...", "name": "..." }`

### `POST /auth/login`
Logs in a user and provisions an access token.
**Body:** `{ "email": "...", "password": "..." }`

### `POST /auth/logout`
Terminates a user session.
**Authentication:** Required.

### `GET /auth/google` & `GET /auth/google/callback`
Initiates server-side browser redirect for Google OAuth login.

### `POST /auth/google/token`
Client-side Google Auth token exchange.
**Body:** `{ "idToken": "..." }`

### `POST /auth/tiktok`
TikTok OAuth login handler.
**Body:** `{ "code": "..." }`

### `GET /auth/me`
Retrieves the currently authenticated user's profile based on the JWT token.
**Authentication:** Required.

### `POST /auth/email/send-code` & `POST /auth/email/verify-code`
Triggers internal email verification code processes via Resend.

### `POST /auth/forgot-password` & `POST /auth/reset-password`
Handles password recovery flows.

---

## 3. Profile & Account Endpoints (`/profile`)

### `GET /profile`
Retrieves the user's detailed profile data, usage limits, and active subscription plan details.
**Authentication:** Required.

### `PATCH /profile`
Updates current user profile details (e.g. name, preferences).
**Authentication:** Required.
**Body:** `{ "name": "...", "contentRegion": "US|UK|CA|...", ... }` 
*(Accepts standard fields like firstName, lastName, avatarUrl, timezone, and locale).*

### `GET /profile/bookmarks`
Gets all products saved by the user.
**Authentication:** Required.

### `POST /profile/bookmarks`
Adds a product to the user's saved list.
**Authentication:** Required.
**Body:** `{ "productId": "..." }`

### `DELETE /profile/bookmarks/:productId`
Removes a product from the user's saved list.
**Authentication:** Required.

---

## 4. Background Job Endpoints (`/jobs`)

These endpoints are used for monitoring and triggering ingestion/cleanup jobs from external cron services.
**Authentication:** Required. Requires `X-API-Key` header (matches `INTERNAL_API_KEY`).

**Scheduled cadence** (all anchored to Africa/Lagos):
- Product ingestion — daily at **00:00**
- Creative ingestion — every 12h at **00:00 / 12:00**
- Stale cleanup — every 5 minutes

### `GET /jobs/status`
Returns the status of all job timers, last-run timestamps, per-job success/error outcomes, and the wall-clock schedule each job runs on.

### `POST /jobs/product-ingestion`
Runs the daily product ingestion pipeline followed by product cleanup. Same code path as the 00:00 Africa/Lagos cron.

### `POST /jobs/creative-ingestion`
Runs the creative ingestion job — adds up to 500 new creative videos in a single pass and refreshes TikTok CDN URLs on revisited creatives. Same code path as the 12-hour cron.

### `POST /jobs/product-refresh`
Triggers the legacy hashtag-based product refresh pipeline (manual only; not on a schedule).

### `POST /jobs/stale-cleanup`
Forces an immediate stale-product cleanup pass.

---

## 5. Ingestion Endpoints (`/ingestion`)

### `POST /ingestion/trigger`
Fires an asynchronous backend pipeline to scrape Social platforms (e.g. TikTok) via EnsembleData and enrich newly discovered products.
Wait times depend on downstream AI providers (DeepSeek, OpenAI).
**Authentication:** Required (Admin or elevated internal keys).

---

## 6. Admin Endpoints (`/admin`)

Admin route reference (health, analytics, users, transactions, waitlist) lives in **[`admin-docs/endpoints.md`](../admin-docs/endpoints.md)** at the repository root. Same `/api/v1` base path and response envelopes as the rest of this file. **OpenAPI (Swagger):** **`/admin-docs`** on the running server.

---

## 7. Waitlist Endpoints (`/waitlist`)

### `POST /waitlist`
Public endpoint. Adds an email to the pre-launch waitlist. Idempotent — a duplicate email returns `200` with `alreadyOnWaitlist: true` instead of erroring.
**Authentication:** None.
**Body:** `{ "email": "founder@example.com", "source": "landing-hero", "referrer": "https://..." }`
**Responses:** `201` for new entries, `200` for duplicates, `400` on invalid email.

---

## 8. Shopify store integration (`/stores/shopify`)

Connect a merchant’s Shopify store (OAuth) and push ValidDs products into their catalog. Routes are mounted under **`/api/v1/stores`**. Responses use the standard envelope in `docs/api-responses.md`. **OpenAPI:** `src/docs/openapi/paths/stores.yaml` (tag **Stores** in `src/docs/openapi/index.yaml`).

### `GET /stores/shopify/install`

**Authentication:** Required (JWT).

**Query parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `shop` | No | Shopify shop domain, e.g. `my-store` or `my-store.myshopify.com`. If omitted, the API assumes the user has no store yet. |
| `returnTo` | No | Optional absolute URL for frontend return flows (validated as URL when present). |

**Behaviour**

- **No `shop`:** `200` — `{ action: 'signup', signupUrl, message }`. Frontend should send the user to `signupUrl` (Shopify signup / marketing funnel).
- **With `shop`:** `200` — `{ action: 'connect', authorizeUrl, state }` when `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_REDIRECT_URI` are set. Frontend should redirect the browser to `authorizeUrl` (Shopify OAuth).
- **Missing Shopify env:** `503` — `SHOPIFY_NOT_CONFIGURED` when `shop` is provided but the server is not configured.

### `GET /stores/shopify/callback`

**Authentication:** None (Shopify redirects the user’s browser here).

**Query parameters (from Shopify)** — validated by the backend: `code`, `hmac`, `shop`, `state` (required); `timestamp`, `host` optional; unknown keys allowed (`passthrough`).

**Behaviour:** Verifies HMAC and signed `state`, exchanges `code` for an Admin API access token, loads shop metadata, encrypts and stores the connection on the user, then **HTTP redirects** the browser to:

- Success: `{FRONTEND_URL}/stores/shopify/callback?status=success&shop=<shop>`
- Error: `{FRONTEND_URL}/stores/shopify/callback?status=error&code=<code>&message=<message>`

(`FRONTEND_URL` comes from env.)

### `GET /stores/shopify/status`

**Authentication:** Required (JWT).

**Response `data`:** `{ connected: boolean, shopifyConfigured: boolean, connection: … }`  
`shopifyConfigured` is true only when all three Shopify env vars are present. `connection` is a safe, public view of the linked shop (no access token).

### `POST /stores/shopify/disconnect`

**Authentication:** Required (JWT).

**Body:** none.

**Response:** `200` — `{ disconnected: true }`. Removes the encrypted token from ValidDs only; the user should uninstall the app in Shopify Admin for full revocation.

### `POST /stores/shopify/products`

**Authentication:** Required (JWT).

**Body:** `{ "productId": "<MongoDB ObjectId>", "price"?: number, "status"?: "active" | "draft" | "archived" }`

**Response:** `201` — created Shopify product summary (e.g. `id`, `handle`, `status`, `adminUrl`, `storefrontUrl`) under `data.product`. Uses Shopify Admin REST **`POST /admin/api/{version}/products.json`** (`SHOPIFY_API_VERSION`, default `2024-10`).

---

## 9. System Health Endpoints

### `GET /health`
Liveness probe. Indicates if the Express process is running.
**Response:** `200 OK`

### `GET /ready`
Readiness probe. Verifies that core dependencies (MongoDB, Redis) are cleanly connected and responding to queries.
**Response:** HTTP 200 array of connection status checks.

