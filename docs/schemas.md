# ValidDs Backend — Schema Documentation

Mongoose models in **`src/models/product.model.ts`** and **`src/models/creative.model.ts`** are the source of truth. Public HTTP shapes are described in **`src/docs/openapi/`**.

---

## 1. `Product` collection

One document per product surfaced through ingestion/enrichment (TikTok-aligned content, AI extraction, supplier data, etc.). **Unique index:** `externalId` + `source`. **`status`:** `active` | `stale` | `archived` (when used).

| Area | Fields (summary) |
|------|-------------------|
| Identity | `externalId`, `source`, `status` |
| Content | `title`, `normalizedTitle`, `description`, `hashtags[]` |
| Taxonomy | `categoryL1`, `categoryL2`, `categoryL3`, `categoryPath` |
| Media | `primaryImageUrl`, `imageUrls[]`, and related source/timestamp fields when present |
| Pricing | `price`, `currency`, `suppliers[]` |
| Market | `rating`, `reviewCount`, `salesEvidence`, `ratingSources[]` |
| Reviews | `reviews[]` — snippets from extraction and other sources |
| Social | `topComments[]` — TikTok-style comment snippets when captured |
| Engagement | `viewCount`, `likeCount`, `commentCount`, `shareCount`, `engagementRate` |
| Creator | `primaryCreator` — handle, display name, TikTok URLs, followers when known |
| AI | `aiIntelligence` — confidence, brand hints, sentiment, category keywords |
| Trend | `trend` — score, direction, reason, `isTrending`, timestamps |
| Discovery | `discoverySections[]`, `relatedProducts[]` when populated |
| Creatives rollup | `creativeCounts` { ads, organic, reviews, total } |
| Freshness | `lastIngestedAt`, `dataSourceUpdatedAt`, `createdAt`, `updatedAt` |

**Text search:** MongoDB text index on `title` + `description` supports `GET /api/v1/products?q=…` when configured.

Legacy MongoDB documents may still carry older field shapes or `source` values from retired pipelines; application code and formatters should tolerate them.

---

## 2. `Creative` collection

One document per TikTok video tied to a product (`productId`).

| Area | Fields (summary) |
|------|-------------------|
| Identity | `productId`, `externalVideoId` |
| Media | `videoPlayUrl`, `thumbnailUrl` |
| Creator | `creator` (tiktokUserId, handle, displayName, followers, verified, tiktokPostUrl, …) |
| Metrics | `metrics` (views, likes, comments, shares, engagementRate, source, fetchedAt) |
| Classification | `section` (`top-ads` \| `trending` \| `influencer-reviews` \| `tutorials` \| `viral-unboxings`), `isAd` |
| Copy | `productName`, `productDescription`, `description` (legacy), `hashtags[]`, `topComments[]` |
| Related | `relatedVideos[]` (nested creator, metrics, topComments, publishedAt) |
| Timing | `publishedAt`, `ingestedAt`, `createdAt`, `updatedAt` |

---

## 3. API-only response fields (Product)

Returned by controllers, not always stored as separate columns:

| Field | Meaning |
|-------|---------|
| `isTopAd` | `true` when `discoverySections` contains `top-ads` |
| `aiInsight` | Reshaped view of `aiIntelligence` for clients |
| `ratings` | Alias for the resolved numeric rating in list/detail payloads |

---

## 4. Image URLs

Product images are whatever URLs were validated/stored during enrichment (`ImageService.probe` may be used where URLs need verification). There is **no** separate third-party image search integration in the current codebase.

---

## 5. Other collections

User, auth, bookmarks, jobs, and admin analytics live in their respective models under `src/models/`. Extend this file when those contracts stabilize.

### `WaitlistEntry` collection

Captured from the public `POST /api/v1/waitlist` endpoint. Read-only for admins via `GET /api/v1/admin/waitlist`.

| Field       | Type     | Notes                                                                |
|-------------|----------|----------------------------------------------------------------------|
| `email`     | string   | Trimmed + lowercased, **unique index**                              |
| `source`    | string?  | Optional attribution tag from the request body (≤ 64 chars)         |
| `referrer`  | string?  | From body, falls back to the `Referer` request header (≤ 512 chars) |
| `ipAddress` | string?  | `req.ip` at the time of signup                                       |
| `userAgent` | string?  | `User-Agent` header (≤ 512 chars)                                   |
| `createdAt` | Date     | Auto-managed via `timestamps`                                        |
| `updatedAt` | Date     | Auto-managed via `timestamps`                                        |

Duplicate submissions are a no-op: the service layer does an explicit `findOne` before insert and responds with the existing entry and `alreadyOnWaitlist: true` (E11000 race conditions are also handled gracefully).
