# ValidDs Backend — Endpoint Documentation

This document explicitly details the core REST API endpoints available within the ValidDs V1 application. It outlines the required request shapes and returned responses.

All endpoints return standardized success envelopes detailed in `docs/api-responses.md`. Base URL path for all endpoints is `/api/v1`.

---

## 1. Product Endpoints

### `GET /products`
Returns a paginated list of trending products with extensive filtering capabilities.
**Authentication:** Optional.
**Query Parameters:**
- `page` *(number, optional)*: Page number (defaults to 1).
- `limit` *(number, optional)*: Items per page (defaults to 20, max 100).
- `category` *(string, optional)*: Filter by canonical category. Accepts a single string or comma-separated list.
- `niche` *(string, optional)*: Filter by specific sub-niche string.
- `trendDirection` *(string, optional)*: Filter by direction. Accepts `rising`, `peaked`, `saturating`, `unknown`.
- `minTrendScore` *(number, optional)*: Filter items above a given trend momentum score (0-100).
- `minViews` *(number, optional)*: Filter out products whose primary video has less than this amount of views.
- `isAd` *(boolean, optional)*: If true, only returns products currently tracked as active ads via Creative Center.
- `region` *(string, optional)*: Filter down to specific TikTok ingestion region.
- `market` *(string, optional)*: Filter by target market (e.g. `US`, `UK`, `CA`).

### `GET /products/:id`
Returns comprehensive data for a single product.
**Authentication:** Optional.
**Path Parameters:** `id` (MongoDB ObjectId).

### `GET /products/search`
Performs a full text search across product titles and tags.
**Authentication:** Optional.
**Query Parameters:** `q` (The search query), `page` (optional).

### `GET /products/categories`
Returns a highly distinct array of existing categories.
**Authentication:** Optional.

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

---

## 4. Background Job Endpoints (`/jobs`)

These endpoints are used for monitoring and triggering the ingestion pipelines.
**Authentication:** Required. Requires `X-API-Key` header (matches `INTERNAL_API_KEY`).

### `GET /jobs/status`
Returns the status of background timers and last run timestamps.

### `POST /jobs/product-refresh`
Triggers the full product refresh pipeline (Ingestion -> AI -> Enrichment -> DB).
*Use this for external cron triggers.*

### `POST /jobs/hashtag-pipeline`
Triggers the deep hashtag ingestion pipeline (EnsembleData hashtag crawl).

### `POST /jobs/stale-cleanup`
Triggers the DB stale data cleanup.

---Removes a product from the user's saved list.
**Authentication:** Required.

---

## 4. Ingestion & Admin Endpoints (`/ingestion`)

### `POST /ingestion/trigger`
Fires an asynchronous backend pipeline to scrape Social platforms (e.g. TikTok) via EnsembleData and enrich newly discovered products.
Wait times depend on downstream AI providers (DeepSeek, OpenAI).
**Authentication:** Required (Admin or elevated internal keys).

---

## 5. System Health Endpoints

### `GET /health`
Liveness probe. Indicates if the Express process is running.
**Response:** `200 OK`

### `GET /ready`
Readiness probe. Verifies that core dependencies (MongoDB, Redis) are cleanly connected and responding to queries.
**Response:** HTTP 200 array of connection status checks.

### `GET /metrics`
(Configured if Prometheus remote write is active). Standard HTTP export endpoint for Prometheus scrapers to parse ingestion volumes, latencies, and system health.
