# ValidDs Backend — Endpoint Documentation

This document explicitly details the core REST API endpoints available within the ValidDs V1 application. It outlines the required request shapes and returned responses.

All endpoints return standardized success envelopes detailed in `docs/api-responses.md`. Base URL path for all endpoints is `/api/v1`.

---

## 1. Product Endpoints

### `GET /products`

Returns a paginated list of products (full catalog by page). Supports optional full-text search and filters on the **same** route.
**Authentication:** Not required (optional JWT improves default `region` when logged in).
**Query Parameters:**

- `page` _(number, optional)_: Page number (defaults to 1).
- `limit` _(number, optional)_: Items per page (defaults to 20, max 100).
- `q` _(string, optional)_: When set, runs MongoDB text search on titles/descriptions (still sorted by `sortBy`, default `gmv`).
- `category` _(string, optional)_: Filter by L1 category. Single value, comma-separated list, or repeated query param for multi-select.
- `subcategory` _(string, optional)_: Filter by L2 subcategory (`categoryL2` in the database). OR match when multiple are selected. Same formats as `category`. Aliases: `subcategories`, `categoryL2`. Valid names from `GET /products/subcategories`.
- `niche` _(string, optional)_: Filter by specific sub-niche string.
- `trendDirection` _(string, optional)_: Filter by direction. Accepts `rising`, `peaked`, `saturating`, `unknown`.
- `minTrendScore` _(number, optional)_: Filter items above a given trend momentum score (0-100).
- `minViews` _(number, optional)_: Filter out products whose primary video has less than this amount of views.
- `minLikes` _(number, optional)_: Minimum total likes on the source post (`likeCount`), e.g. `10000`.
- `minGmv` / `maxGmv` _(number, optional)_: Filter by `totalGmv` (aliases: `minTotalGmv`, `maxTotalGmv`).
- `minUnits` / `maxUnits` _(number, optional)_: Filter by `totalSales` (aliases: `minUnitsSold`, `maxUnitsSold`).
- `minEngagementRate` _(number, optional)_: Minimum likes÷views ratio as a percent, e.g. `1` = 1%.
- `startDate` _(string, optional)_: Only posts on or after this ISO date (`YYYY-MM-DD`), e.g. `2026-04-29`.
- `section` _(string, optional)_: Require a discovery section slug on the product (e.g. `top-ads`, `trending`, `viral`). See OpenAPI enum.
- `isAd` _(boolean, optional)_: When `true`, same as the `top-ads` discovery bucket (`discoverySections` contains `top-ads`). When `false`, excludes that bucket.
- `feed` _(string, optional)_: Convenience UI tab selector: `discover` or `top-opportunities`. Only used when `sortBy` is omitted.
- `sortBy` _(string, optional)_: `gmv_desc`, `gmv_asc`, `units_sold_desc`, `units_sold_asc`, `last_ingested` (alias `recent`), `trendScore`, `views`, `engagement`. If omitted, defaults depend on `feed` (`discover` → `recent`, `top-opportunities` → `gmv`, otherwise `gmv`).

**Feed card fields** (each item in `data.products`): `price`, optional `originalPrice` (strikethrough/was price when higher than `price`), `storeLinks` (TikTok Shop + merchant DTC links), `officialWebsiteUrl`, plus standard metrics (`totalGmv`, `totalSales`, `aiInsight`, etc.). See OpenAPI `ProductFeedItem` schema.

### `GET /products/for-you`

Personalized product recommendations for the signed-in user (saved products, search history, Shopify import history).
**Authentication:** Required (JWT).

- `limit` _(number, optional)_: Max items (default 12, max 24).

**Response `data`:** `{ products, personalized, pagination }` — `personalized` is `false` for cold-start users with no activity history.

### `GET /products/:id/you-may-like`

Products you may like for a specific product detail context. Blends personalization with same-subcategory related products when the user is signed in; falls back to related products only when anonymous or cold-start.
**Authentication:** Optional (JWT improves personalization).

- `limit` _(number, optional)_: Max items (default 8, max 16).

**Response `data`:** `{ youMayLike, personalized }`

### `GET /products/compare`

AI-assisted comparison of 2–5 products by MongoDB ObjectId.
**Authentication:** Not required.

- `ids` _(string, required)_: Comma-separated ObjectIds, or repeat the query param (`?ids=id1,id2` or `?ids=id1&ids=id2`). Minimum 2, maximum 5.

**Response `data`:** `{ products, analysis, notFound }`

- `products` — lean snapshot per product (`ProductCompareItem` schema): title, price, category, GMV, trend, etc.
- `analysis` — AI-generated comparison (`summary`, `recommendation`, per-product `pros`/`cons`/`bestFor`, dimension leaders). `null` when fewer than two valid products are found.
- `notFound` — requested IDs that were missing or not listable.

### `GET /products/:id`

Returns comprehensive data for a single product.
**Authentication:** Not required (optional JWT improves `youMayLike` personalization).
**Path Parameters:** `id` (MongoDB ObjectId).

**Response `data`:** `product` (full detail), `relatedProducts` (up to 8 feed cards in the same L2 subcategory), `youMayLike` (personalized or related-only feed cards), `personalized` (`true` when user activity was used), `relatedVideos` (commercial/non-ad creatives), `relatedAds` (top-ad/paid creatives), `freshness`.

**Product detail highlights:** `originalPrice`, `storeLinks`, `officialWebsiteUrl`, `officialProductUrl`, and `aiInsight.pageSummary` / `aiInsight.reviewSummary` on `GET /products/:id` when populated by ingest.

### `GET /products/:id/similar-products`

Alias of `GET /products/:id/related-products`.

### `GET /products/categories`

Returns L1 category names that have at least one listable product in the request market (flat array, canonical order). Categories with zero products are omitted.
**Authentication:** Not required (optional JWT sets market via `attachMarketModels`).
**Response `data`:** `{ "categories": ["Beauty & Personal Care", ...] }`

### `GET /products/subcategories`

Returns L2 subcategories that have at least one listable product. Optional query `?category=<L1>` for a flat list; omit for full L1→L2 map (only L1/L2 keys with products are included).
**Authentication:** Not required.

### `GET /products/taxonomy`

Full L1 → L2 → L3 taxonomy tree.
**Authentication:** Not required.

---

## 2. Creative Endpoints (`/creatives`)

Public discovery and detail for TikTok/Meta ad creatives. **OpenAPI:** `src/docs/openapi/paths/creatives.yaml`.

### `GET /creatives`

Paginated creative feed with filters (category, product, section, engagement, etc.).
**Authentication:** Not required.

- `sortBy` _(string, optional)_: `views` (default), `likes`, `recent` (post publish date), `last_ingested` (when ValidDs ingested the creative; aliases `last-ingested`, `ingested_desc`), `engagement`.

**Creative card fields** include `tiktokUrl` (direct TikTok post link; `null` for Meta Ad Library creatives), `embedUrl`, `videoProxyUrl`, `thumbnailProxyUrl`, nested `relatedVideos`, and linked `product` summary.

### `GET /creatives/:id`

Single creative detail. Same schema as list items.

---

## 3. Authentication Endpoints (`/auth`)

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

## 4. Profile & Account Endpoints (`/profile`)

### `GET /profile`

Retrieves the user's detailed profile data, usage limits, and active subscription plan details.
**Authentication:** Required.

### `PATCH /profile`

Updates current user profile details (e.g. name, preferences).
**Authentication:** Required.
**Body:** `{ "name": "...", "contentRegion": "US|UK|CA|...", ... }`
_(Accepts standard fields like firstName, lastName, avatarUrl, timezone, and locale)._

### `GET /profile/content-region`

Returns `{ "contentRegion": "US" }` (user's market for product/creative data).
**Authentication:** Required.

### `PATCH /profile/content-region`

Updates content region only.
**Authentication:** Required.
**Body:** `{ "contentRegion": "US" }` — one of `US`, `CA`, `MX`, `UK`, `ES`, `DE`, `IT`, `FR`, `AU`, `NZ`.

### `GET /profile/bookmarks`

Gets all saved products and creatives for the user.
**Authentication:** Required.

**Response `data`:** `{ bookmarks }` — sorted by `savedAt` (newest first). Each item includes `kind` (`product` | `creative`) and the full feed card at the top level:

- **Product** (`kind: "product"`): `id`, `title`, `price`, `originalPrice`, `storeLinks`, `aiInsight`, `trend`, …
- **Creative** (`kind: "creative"`): `id`, `tiktokUrl`, `creator`, `metrics`, `productName`, `videoProxyUrl`, …

Plus bookmark fields: `savedAt`, optional `notes`, optional `tags`.

### `POST /profile/bookmarks`

Saves a product or creative.
**Authentication:** Required.
**Body:** exactly one of:

- `{ "productId": "...", "notes"?: "...", "tags"?: ["..."] }`
- `{ "creativeId": "...", "notes"?: "...", "tags"?: ["..."] }`

**Response `data`:** `{ bookmarks }` — same shape as `GET /profile/bookmarks`.

### `DELETE /profile/bookmarks/:id`

Removes a bookmark.
**Authentication:** Required.

- `kind` _(query, optional)_: `product` (default) or `creative`

**Response `data`:** `{ bookmarks }` — updated list with full feed cards.

---

## 5. TikTok Live (`/tiktok/live`)

### `GET /tiktok/live/discover`

Returns cached **live** sessions from MongoDB (`LiveSession` with `status: live`), plus watchlist metadata. **Only streams with at least 2 concurrent viewers** (latest poll snapshot or `peakViewers`) are included in `sessions`, `live`, and `liveCount`. **Read-only** — no ScrapeCreators call on this route; **`data.ended`** is always an empty array.
**Authentication:** Required (JWT).

### `POST /tiktok/live/reconcile`

Re-checks every open live session with ScrapeCreators and **ends** database rows that are no longer live. Response **`data.ended`** lists handles closed in that pass. Requires **`SCRAPECREATORS_API_KEY`** (otherwise **503** `SCRAPECREATORS_NOT_CONFIGURED`).
**Authentication:** Required (JWT).

### `POST /tiktok/live/watchlist`

Adds a TikTok **handle** to the shared live-monitoring watchlist (`TrackedStore`). Same enrichment and body as admin **`POST /tiktok/stores`**; returns **`201`** when created or **`200`** if the handle was already on the watchlist. When **`SCRAPECREATORS_API_KEY`** is set, the server probes live status; a **`LiveSession`** is created only if the stream is live **with at least 2 concurrent viewers**, so **`GET /tiktok/live/discover`** can list it without waiting for the hourly job.
**Authentication:** Required (JWT — any signed-in user).
**Body:** `{ "handle": "brandname" }` — optional `displayName`, `notes`, `tags`, `shopUrl` (same as admin add-store).

---

## 6. Background Job Endpoints (`/jobs`)

These endpoints are used for monitoring and triggering ingestion/cleanup jobs from external cron services.
See **`docs/cron-jobs.md`** for Render/GitHub/crontab setup (`render.yaml`, `cron/trigger-job.mjs`).

**Authentication:** Required. Requires `X-API-Key` header (matches `INTERNAL_API_KEY`).

**Production with external cron:** `ENABLE_BACKGROUND_JOBS=true`, `ENABLE_IN_PROCESS_SCHEDULERS=false`.

**Scheduled cadence** (all anchored to Africa/Lagos):

- Product ingestion — daily at **00:00**
- Creative ingestion — every 12h at **00:00 / 12:00**
- Stale cleanup — every 5 minutes
- TikTok live monitor discover — **every 1 hour** (wall-clock from server start; first run ~30s after jobs start). ScrapeCreators live checks on the **union of active tracked stores and handles with open `LiveSession` rows**; Apify for shop sold-count snapshots when sessions start/end; updates `LiveSession` documents (ends rows when no longer live).

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

### `POST /jobs/live-monitor-discover`

Runs TikTok live discovery: ScrapeCreators live checks on **active watchlist handles plus any handle with `LiveSession` status `live`**, then ends sessions the API reports as not live; Apify shop snapshots for GMV at session start/end. Same code path as the **hourly** in-process cron. Skips live API calls if `SCRAPECREATORS_API_KEY` is unset. Returns immediately while work runs in the background.

---

## 7. Ingestion Endpoints (`/ingestion`)

### `POST /ingestion/trigger`

Fires an asynchronous backend pipeline to discover social posts (e.g. TikTok) and enrich newly discovered products. Ingestion is currently disabled until sources are wired into the orchestrator.
Wait times depend on downstream AI providers (DeepSeek, OpenAI).
**Authentication:** Required (Admin or elevated internal keys).

---

## 8. Admin Endpoints (`/admin`)

Admin route reference (health, analytics, users, transactions, waitlist) lives in **[`admin-docs/endpoints.md`](../admin-docs/endpoints.md)** at the repository root. Same `/api/v1` base path and response envelopes as the rest of this file. **OpenAPI (Swagger):** **`/admin-docs`** on the running server.

---

## 9. Waitlist Endpoints (`/waitlist`)

### `POST /waitlist`

Public endpoint. Adds an email to the pre-launch waitlist. Idempotent — a duplicate email returns `200` with `alreadyOnWaitlist: true` instead of erroring.
**Authentication:** None.
**Body:** `{ "email": "founder@example.com", "source": "landing-hero", "referrer": "https://..." }`
**Responses:** `201` for new entries, `200` for duplicates, `400` on invalid email.

---

## 10. Shopify store integration (`/stores/shopify`)

Connect a merchant’s Shopify store (OAuth) and push ValidDs products into their catalog. Routes are mounted under **`/api/v1/stores`**. Responses use the standard envelope in `docs/api-responses.md`. **OpenAPI:** `src/docs/openapi/paths/stores.yaml` (tag **Stores** in `src/docs/openapi/index.yaml`).

### `GET /stores/shopify/install`

**Authentication:** Required (JWT).

**Query parameters**

| Param      | Required | Description                                                                                                              |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `shop`     | No       | Shopify shop domain, e.g. `my-store` or `my-store.myshopify.com`. If omitted, the API assumes the user has no store yet. |
| `returnTo` | No       | Optional absolute URL for frontend return flows (validated as URL when present).                                         |

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

## 11. System Health Endpoints

### `GET /health`

Liveness probe. Indicates if the Express process is running.
**Response:** `200 OK`

### `GET /ready`

Readiness probe. Verifies that core dependencies (MongoDB, Redis) are cleanly connected and responding to queries.
**Response:** HTTP 200 array of connection status checks.
