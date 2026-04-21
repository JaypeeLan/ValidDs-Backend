# ValidDs Backend — Schema Documentation

Mongoose models in **`src/models/product.model.ts`** and **`src/models/creative.model.ts`** are the source of truth. Public HTTP shapes are described in **`src/docs/openapi/`**.

---

## 1. `Product` collection

One document per product discovered from TikTok Shop (via EchoTik) or a TikTok post (via EnsembleData). **Unique index:** `externalId` + `source`. **`status`:** `active` | `stale` | `archived`.

| Area | Fields (summary) |
|------|-------------------|
| Identity | `externalId`, `source` (`'echotik'` or `'ensemble'`), `status` |
| Content | `title`, `normalizedTitle`, `description`, `hashtags` |
| Taxonomy | `categoryL1`, `categoryL2`, `categoryL3`, `categoryPath` |
| Media | `primaryImageUrl`, `imageUrls[]` — EchoTik products store original volces.com URLs; resolved to temp URLs at serve time via Redis cache |
| Pricing | `price`, `currency`, `suppliers[]` (platform, productUrl, price, currency, shippingDays, moq, checkedAt) |
| Market | `rating`, `reviewCount`, `salesEvidence` (unitsSold, store, **storeUrl** → direct product URL, timeframe, sourceBreakdown[], fetchedAt), `ratingSources[]` |
| Reviews | `reviews[]` — Google Shopping review snippets from SearchApi (`source`, `text`, `collectedAt`) |
| Social | `topComments[]` — verified TikTok Shop buyer comments from EchoTik (comment, text, likeCount, sentiment, source, collectedAt) |
| Engagement | `viewCount`, `likeCount`, `commentCount`, `shareCount`, `engagementRate` — from top EnsembleData creator post when available |
| Creator | `primaryCreator` — real TikTok creator (resolved via EnsembleData keyword search); falls back to EchoTik seller if no creator found |
| AI | `aiIntelligence` (confidence, confidenceReason, brand, categoryKeywords, buyingSentimentScore, buyingSentimentReason, extractedAt) |
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
