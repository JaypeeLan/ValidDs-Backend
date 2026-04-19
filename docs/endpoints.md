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

### `GET /jobs/status`
Returns the status of job timers and last-run timestamps.

### `POST /jobs/product-refresh`
Triggers the product refresh pipeline.

### `POST /jobs/hashtag-pipeline`
Triggers the hashtag ingestion pipeline.

### `POST /jobs/stale-cleanup`
Triggers stale data cleanup.

---

## 5. Ingestion Endpoints (`/ingestion`)

### `POST /ingestion/trigger`
Fires an asynchronous backend pipeline to scrape Social platforms (e.g. TikTok) via EnsembleData and enrich newly discovered products.
Wait times depend on downstream AI providers (DeepSeek, OpenAI).
**Authentication:** Required (Admin or elevated internal keys).

---

## 6. Admin Endpoints (`/admin`)

### `GET /admin/health`
Returns system status metrics (memory, CPU, mongo, redis, jobs).
**Authentication:** Required (admin role).

### `GET /admin/analytics/users`
Returns user analytics (total users, new users today, by plan, by status).
**Authentication:** Required (admin role).

### `GET /admin/analytics/products`
Returns product analytics (totals, fresh products, top categories, by source).
**Authentication:** Required (admin role).

### `GET /admin/analytics/creatives`
Returns TikTok creative analytics: total creative documents, total video slots (primary plus related videos), creatives ingested in the last 24h, counts by feed `section`, ads vs organic (`isAd`), and top 10 `categoryL1` buckets.
**Authentication:** Required (admin role).

### `GET /admin/users`
Returns paginated user records for dashboard management.
**Authentication:** Required (admin role).

### `DELETE /admin/users/:userId`
Soft-deletes a user account.
**Authentication:** Required (admin role).

### `GET /admin/transactions`
Returns paginated transaction records.
**Authentication:** Required (admin role).

### `POST /admin/transactions`
Stores a transaction record.
**Authentication:** Required (admin role).
**Body:** `{ "userId": "...", "amount": 49, "currency": "USD", "status": "paid", "mode": "test", "provider": "stripe" }`

---

## 7. System Health Endpoints

### `GET /health`
Liveness probe. Indicates if the Express process is running.
**Response:** `200 OK`

### `GET /ready`
Readiness probe. Verifies that core dependencies (MongoDB, Redis) are cleanly connected and responding to queries.
**Response:** HTTP 200 array of connection status checks.

### `GET /metrics`
(Configured if Prometheus remote write is active). Standard HTTP export endpoint for Prometheus scrapers to parse ingestion volumes, latencies, and system health.
