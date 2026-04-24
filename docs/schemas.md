# ValidDs Backend — Schema Documentation

Mongoose models in **`src/models/product.model.ts`** and **`src/models/creative.model.ts`** are the source of truth. Public HTTP shapes are described in **`src/docs/openapi/`**.

---

## 1. `Product` collection

One document per product discovered from TikTok Shop (via EchoTik) or a TikTok post (via EnsembleData). **Unique index:** `externalId` + `source`. **`status`:** `active` | `stale` | `archived`.

| Area | Fields (summary) |
|------|-------------------|
| Identity | `externalId` (EchoTik `product_id`), `source` (`'echotik'` or `'ensemble'`), `status` |
| Content | `title`, `normalizedTitle`, `description`, `hashtags[]` — hashtags sourced from the top EchoTik `/product/video/list` video's `hash_tag` + `video_desc` |
| Taxonomy | `categoryL1`, `categoryL2`, `categoryL3`, `categoryPath` — resolved from EchoTik `/category/l1|l2|l3` (2,600+ IDs, 7-day Redis cache). Raw IDs never leak to clients; the response formatter also runs `sanitiseCategoryFields()` on older docs |
| Media | `primaryImageUrl`, `imageUrls[]` (resolved temp URLs) + `sourcePrimaryImageUrl`, `sourceImageUrls[]`, `imagesResolvedAt` (originals kept for refresh). Images are `probe()`-verified at ingest and fall back to SearchApi google_images when EchoTik's returned URL won't render |
| Pricing | `price`, `currency`, `suppliers[]` (platform, productUrl, price, currency, shippingDays, moq, checkedAt) |
| Market | `rating`, `reviewCount`, `salesEvidence` (unitsSold, store, **storeUrl** → direct product URL, timeframe, sourceBreakdown[], fetchedAt), `ratingSources[]` |
| Reviews | `reviews[]` — Google Shopping review snippets from SearchApi (`source`, `text`, `collectedAt`) |
| Social | `topComments[]` — verified TikTok Shop buyer comments from EchoTik (comment, text, likeCount, sentiment, source, collectedAt) |
| Engagement | `viewCount`, `likeCount`, `commentCount`, `shareCount`, `engagementRate` — taken from the **top video** of EchoTik `/product/video/list` (by `total_views_cnt`). `engagementRate = (likes + comments + shares) / views` |
| Creator | `primaryCreator` — resolved via EnsembleData `/post/info` using the `video_id` from the top EchoTik video; falls back to the EchoTik seller when the post is deleted or private |
| AI | `aiIntelligence` (confidence, confidenceReason, **brand**, categoryKeywords, buyingSentimentScore, buyingSentimentReason, extractedAt). `brand` is extracted at ingest from bracketed tokens in the title or `Brand:` keys in the description — never guessed |
| Trend | `trend` (score, direction, reason, isTrending, calculatedAt) — derived from EchoTik 30-day sales velocity |
| Discovery | `discoverySections[]` (e.g. `trending`, `top-ads`, `top-rated`, `viral`), `relatedProducts[]` — from SearchApi google_product |
| Creatives rollup | `creativeCounts` { ads, organic, reviews, total } |
| EchoTik metrics | See EchoTik-specific fields table below |
| Freshness | `lastIngestedAt`, `dataSourceUpdatedAt`, `createdAt`, `updatedAt` |

**Text search:** MongoDB text index on `title` + `description` supports `GET /api/v1/products?q=…`.

### EchoTik-specific fields (`source = 'echotik'`)

| Field | Type | Description |
|---|---|---|
| `echotikProductId` | `string` | TikTok Shop `product_id` |
| `region` | `string` | Market region e.g. `'US'`, `'GB'` |
| `commissionRate` | `number` | Affiliate commission decimal e.g. `0.13` = 13% |
| `totalSale30d` | `number` | Units sold in last 30 days |
| `totalSale7d` | `number` | Units sold in last 7 days |
| `totalGmv` | `number` | Total gross merchandise value |
| `totalGmv30d` | `number` | GMV in last 30 days |
| `totalCreators` | `number` | Number of influencers selling this product |
| `salesChannel` | `'video' \| 'live' \| 'none'` | Primary sales driver |
| `freeShipping` | `boolean` | Whether free shipping is offered |
| `isManagedStore` | `boolean` | Whether seller is a TikTok-managed store (is_s_shop) |

### salesEvidence.storeUrl

For EchoTik products this is always the direct TikTok product page:
`https://www.tiktok.com/view/product/{productId}`

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

Returned by controllers, not stored as separate columns:

| Field | Meaning |
|-------|---------|
| `isTopAd` | `true` when `discoverySections` contains `top-ads` |
| `aiInsight` | Reshaped view of `aiIntelligence` for clients |
| `ratings` | Alias for the resolved numeric rating in list/detail payloads |

---

## 4. Image URL serving

EchoTik product images (`source = 'echotik'`) are stored as original volces.com URLs in MongoDB. The controller resolves them at serve time:

```
Product controller
  → toPlainWithImages()
  → resolveEchoTikImageUrls(urls)     [src/ingestion/echotik/echotik.image.ts]
      → check Redis cache (key: echotik:img:<url>, TTL: 20h)
      → on miss: POST /batch/cover/download to EchoTik API
      → cache result, return temp URL
  → applyResolvedImages(product, urlMap)
```

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
