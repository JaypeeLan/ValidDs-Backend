# ValidDs Backend — Schema Documentation

Mongoose models in **`src/models/product.model.ts`** and **`src/models/creative.model.ts`** are the source of truth. Public HTTP shapes are described in **`src/docs/openapi/`**.

---

## 1. `Product` collection

One document per product surfaced through ingestion/enrichment (TikTok-aligned content, AI extraction, supplier data, etc.). **Unique index:** `externalId` + `source`.

### Product `status` (catalog lifecycle)

Mongoose enum (default **`review`**): **`active`** | **`review`** | **`invalid`**.

| Value     | Meaning                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `active`  | Live in the feed. Set by successful internal ingest (`POST /internal/ingest/product`). |
| `review`  | Pending QA. Default for admin-created products (`POST /admin/products`).               |
| `invalid` | Rejected or failed validation. Excluded from feed/search.                              |

**Operational values** (still present in older documents and set by jobs; not in the Mongoose enum):

| Value      | Meaning                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `stale`    | Re-ingest stopped. Set by stale-cleanup when `lastIngestedAt` is older than 24h while `status` was `active`. |
| `archived` | Manually hidden. Excluded from feed/search with `invalid`.                                                   |

Feed eligibility: `status` not in `archived` or `invalid` (`LISTABLE_PRODUCT_FILTER`). Region counts and some queries require `status: active` only.

### Product `validationStatus` (QA pipeline — separate field)

Not the same as catalog `status`. Common values: **`pending`** (admin create default), **`valid`** (successful ingest), **`invalid`** (maintenance scripts mark unfixable records).

| Area             | Fields (summary)                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Identity         | `externalId`, `source`, `status`, `validationStatus`                                                               |
| Content          | `title`, `normalizedTitle`, `description`, `hashtags[]`                                                            |
| Taxonomy         | `categoryL1`, `categoryL2`, `categoryL3`, `categoryPath`                                                           |
| Media            | `primaryImageUrl`, `imageUrls[]`, and related source/timestamp fields when present                                 |
| Pricing          | `price`, `currency`, `suppliers[]`                                                                                 |
| Market           | `rating`, `reviewCount`, `salesEvidence`, `ratingSources[]`                                                        |
| Reviews          | `reviews[]` — TikTok Shop uses `name` + `review`; AI extraction uses `author` + `content`                          |
| Suppliers        | `suppliers[]` — `source`, optional `platform`, `onSale`, `soldLast30Days`, Shopify App + Amazon rows               |
| Social           | `topComments[]` — TikTok-style comment snippets when captured                                                      |
| Engagement       | `viewCount`, `likeCount`, `commentCount`, `shareCount`, `engagementRate`                                           |
| Creator          | `primaryCreator` — handle, display name, TikTok URLs, followers when known                                         |
| AI               | `aiIntelligence` — confidence, brand hints, sentiment, `marketingAnalysis` (insight + `angles[]` hook/body/target) |
| Trend            | `trend` — score, direction, reason, `isTrending`, timestamps                                                       |
| Discovery        | `discoverySections[]`, `relatedProducts[]` when populated                                                          |
| Creatives rollup | `creativeCounts` { ads, organic, reviews, total }                                                                  |
| Freshness        | `lastIngestedAt`, `dataSourceUpdatedAt`, `createdAt`, `updatedAt`                                                  |

**Text search:** MongoDB text index on `title` + `description` supports `GET /api/v1/products?q=…` when configured.

Legacy MongoDB documents may still carry older field shapes or `source` values from retired pipelines; application code and formatters should tolerate them.

---

## 2. `Creative` collection

One document per TikTok video tied to a product (`productId`).

| Area           | Fields (summary)                                                                           |
| -------------- | ------------------------------------------------------------------------------------------ |
| Identity       | `productId`, `externalVideoId`                                                             |
| Media          | `videoPlayUrl`, `thumbnailUrl`                                                             |
| Creator        | `creator` (tiktokUserId, handle, displayName, followers, verified, tiktokPostUrl, …)       |
| Metrics        | `metrics` (views, likes, comments, shares, engagementRate, source, fetchedAt)              |
| Classification | `section` (`top-ads` \| `trending`), `isAd`                                                |
| Copy           | `productName`, `productDescription`, `description`, `angle`, `hashtags[]`, `topComments[]` |
| Related        | `relatedVideos[]` (nested creator, metrics, topComments, publishedAt)                      |
| Timing         | `publishedAt`, `ingestedAt`, `createdAt`, `updatedAt`                                      |

---

## 3. API response shapes (Product)

| Endpoint            | Schema                | Notes                                                                          |
| ------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `GET /products`     | **`ProductFeedItem`** | Discovery cards only — no suppliers blob, marketing analysis, reviews, etc.    |
| `GET /products/:id` | **`Product`** (full)  | Detail drawer/page including `aiInsight.marketingAnalysis`, history, suppliers |

### API-only fields (detail + feed)

Returned by controllers, not always stored as separate columns:

| Field                             | Meaning                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `isTopAd`                         | `true` when `discoverySections` contains `top-ads`                                                                              |
| `aiInsight`                       | Reshaped `aiIntelligence`: confidence, buyingSentiment, **marketingAnalysis**, brand, niche, audience, problem/value statements |
| `ratings`                         | Alias for the resolved numeric rating in list/detail payloads                                                                   |
| `salesHistory` / `salesTrend`     | Unit-sales snapshots and windowed trend (`windows[].value` = units)                                                             |
| `revenueHistory` / `revenueTrend` | GMV snapshots and windowed trend (`windows[].value` = revenue)                                                                  |

---

## 4. Image URLs

Product images are whatever URLs were validated/stored during enrichment (`ImageService.probe` may be used where URLs need verification). There is **no** separate third-party image search integration in the current codebase.

---

## 5. Other collections

User, auth, bookmarks, jobs, and admin analytics live in their respective models under `src/models/`. Extend this file when those contracts stabilize.

### `WaitlistEntry` collection

Captured from the public `POST /api/v1/waitlist` endpoint. Read-only for admins via `GET /api/v1/admin/waitlist` (see [`admin-docs/endpoints.md`](../admin-docs/endpoints.md)).

| Field       | Type    | Notes                                                               |
| ----------- | ------- | ------------------------------------------------------------------- |
| `email`     | string  | Trimmed + lowercased, **unique index**                              |
| `source`    | string? | Optional attribution tag from the request body (≤ 64 chars)         |
| `referrer`  | string? | From body, falls back to the `Referer` request header (≤ 512 chars) |
| `ipAddress` | string? | `req.ip` at the time of signup                                      |
| `userAgent` | string? | `User-Agent` header (≤ 512 chars)                                   |
| `createdAt` | Date    | Auto-managed via `timestamps`                                       |
| `updatedAt` | Date    | Auto-managed via `timestamps`                                       |

Duplicate submissions are a no-op: the service layer does an explicit `findOne` before insert and responds with the existing entry and `alreadyOnWaitlist: true` (E11000 race conditions are also handled gracefully).
