# ValidDs Backend — Schema Documentation

Mongoose models in **`src/models/product.model.ts`** and **`src/models/creative.model.ts`** are the source of truth. Public HTTP shapes are described in **`src/docs/openapi/`**. A Word export aligned to these models lives at **`project_docs/schemas.docx`** (updated 2026-04-18).

---

## 1. `Product` collection

One document per product discovered from a TikTok post. **Unique index:** `externalId` + `source`. **`status`:** `active` \| `stale` \| `archived`.

| Area | Fields (summary) |
|------|-------------------|
| Identity | `externalId`, `source`, `status` |
| Content | `title`, `normalizedTitle`, `description`, `hashtags` |
| Taxonomy | `categoryL1`, `categoryL2`, `categoryL3`, `categoryPath` |
| Media | `primaryImageUrl`, `imageUrls[]` |
| Pricing | `price`, `currency`, `suppliers[]` (platform, productUrl, price, currency, shippingDays, moq, checkedAt) |
| Market | `rating`, `reviewCount`, `salesEvidence` (unitsSold, store, storeUrl, timeframe, **sourceBreakdown[]**, fetchedAt), `ratingSources[]`, `reviews[]` |
| Social | `topComments[]` (TikTok comments + sentiment) |
| Engagement | `viewCount`, `likeCount`, `commentCount`, `shareCount`, `engagementRate` |
| Creator | `primaryCreator` (handle, followers, tiktokPostUrl, …) |
| AI | `aiIntelligence` (confidence, reasons, brand, categoryKeywords, buying sentiment, extractedAt) |
| Trend | `trend` (score, direction, reason, isTrending, calculatedAt) |
| Discovery | `discoverySections[]` (e.g. `trending`, `top-ads`, `viral`), `relatedProducts[]` |
| Creatives rollup | `creativeCounts` { ads, organic, reviews, total } |
| Freshness | `lastIngestedAt`, `dataSourceUpdatedAt`, `createdAt`, `updatedAt` |

**Text search:** MongoDB text index on `title` + `description` supports `GET /api/v1/products?q=…`.

**Removed / obsolete concepts (do not document on Product):** embedded `ProductVideo`, `adSignals`, `aiExtraction`, flat `category`/`tags` instead of taxonomy + `hashtags`.

---

## 2. `Creative` collection

One document per TikTok video tied to a product (`**productId**`).

| Area | Fields (summary) |
|------|-------------------|
| Identity | `productId`, `externalVideoId` |
| Media | `videoPlayUrl`, `thumbnailUrl` |
| Creator | `creator` (tiktokUserId, handle, displayName, followers, verified, tiktokPostUrl, …) |
| Metrics | `metrics` (views, likes, comments, shares, engagementRate, **source**, **fetchedAt**) |
| Classification | `section` (`top-ads` \| `trending` \| `influencer-reviews` \| `tutorials` \| `viral-unboxings`), `isAd` |
| Copy | `productName`, `productDescription`, `description` (legacy), `hashtags[]`, `topComments[]` |
| Related | `relatedVideos[]` (nested creator, metrics, topComments, publishedAt) |
| Timing | `publishedAt`, `ingestedAt`, `createdAt`, `updatedAt` |

---

## 3. API-only response fields (Product)

Returned by controllers, not stored as separate columns:

| Field | Meaning |
|-------|---------|
| `isTopAd` | `true` when `discoverySections` contains `top-ads`. |
| `aiInsight` | Reshaped view of `aiIntelligence` for clients. |
| `ratings` | Alias for the resolved numeric rating in list/detail payloads. |

---

## 4. Other collections

User, auth, bookmarks, jobs, and admin analytics live in their respective models under `src/models/`. Extend this file when those contracts stabilize.
