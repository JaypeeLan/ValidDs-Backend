# ValidDs Backend — Schema Documentation

This document explicitly outlines the data models established for ValidDs V1. Because ValidDs serves as a product research and validation platform for dropshippers, the schema is hyper-focused on collecting and structuring engagement metrics, trend momentum, and sourcing intelligence.

All schemas are implemented via Mongoose and stored in MongoDB Atlas.

---

## 1. Product Entity

**Entity Name:** `Product`  
**Purpose:** Serves as the core entity within ValidDs. It represents a trending dropshipping item extracted from viral social media posts.  
**Relationships:** Acts as the parent container for `ProductVideo`, `ProductTrend`, `StoreRef`, and `SupplierRef` subdocuments.

### Why these fields exist

| Field | Type | Description & Purpose |
|-------|------|-----------------------|
| `externalId` | `String` | The unique identifier from the primary social media source (e.g., TikTok video ID). Prevents duplicate processing during ingestion. |
| `source` | `String` | Determines where the product was scraped from (usually `tiktok`). |
| `title` | `String` | Sterilized, concise name of the product (≤ 80 characters). Vital for UI rendering and dropshipper readability. |
| `description` | `String` | Single-sentence AI-generated summary of the product. |
| `category` | `String` | High-level, canonical category (e.g., `Home & Kitchen`, `Tech Gadgets`) for broad directory filtering. |
| `tags` | `[String]` | Array of hashtags from the original viral post. Used for search and categorization. |
| `primaryImageUrl` | `String` | Original high-resolution product image, typically extracted from TeemDrop first and Rainforest/Amazon second. Used as the main thumbnail. |
| `imageUrls` | `[String]` | Array of supporting high-res product images. |
| `price` | `Number` | The supplier price chosen for the product card. When TeemDrop is used, this now comes from `productMaxPrice`. |
| `unitsSold` | `Number` | Verified sales estimate from supplier proof or grounded web research. Defaults to `0` when no verifiable source exists. |
| `store` | `String` | The supplier source used for the enrichment payload, typically `TeemDrop` or `Amazon`. |
| `rating` | `Number` | Aggregated market rating (e.g., 4.7), providing immediate trust signals. |
| `reviewsCount` | `Number` | Total review count in the broader market, establishing product authority. |
| `engagementRate` | `Number` | Derived metric combining likes, comments, and shares against total views. The primary signal for true virality. |
| `aiExtraction` | `Object` | (Subdocument) Stores AI metadata like `confidence`, `sentimentSummary`, and `buyingIntentScore` which quantify the comment-section psychology. |
| `adSignals` | `Object` | (Subdocument) Indicates if the product data was captured from an active Ad campaign via Creative Center, which is a massive validation signal. |

---

## 2. Videos Entity (Subdocument)

**Entity Name:** `ProductVideo`  
**Purpose:** Represents the viral social media post that established the product's trend velocity. Embedded inside the `Product` entity because in V1, videos exist entirely to validate the Product.

### Why these fields exist

| Field | Type | Description & Purpose |
|-------|------|-----------------------|
| `videoId` | `String` | The native TikTok/social identifier. |
| `url` | `String` | The direct URL to the video on the native platform. |
| `playUrl` | `String` | Direct `.mp4` link from the origin server (if available without auth) for localized playback. |
| `viewCount` / `likeCount` / `commentCount` / `shareCount` | `Number` | The raw foundational engagement metrics. Required to calculate momentum. |
| `creatorHandle` | `String` | The name/handle of the account that posted it, allowing dropshippers to track specific creators. |
| `isAd` | `Boolean` | Flag indicating if this specific video is an organic post or paid media. |

---

## 3. Trends Entity (Subdocument)

**Entity Name:** `ProductTrend`  
**Purpose:** Standardizes the velocity and momentum tracking for the product over time.

### Why these fields exist

| Field | Type | Description & Purpose |
|-------|------|-----------------------|
| `direction` | `Enum` | Can be `rising`, `peaked`, `saturating`, or `unknown`. A generalized signal of trend lifecycle. |
| `score` | `Number` | An AI-estimated momentum score (0-100). |
| `calculatedAt` | `Date` | Timestamp of when the velocity metrics were last computed. |

*(Note: Advanced 7-day and 30-day view velocity fields are designed into the schema for Phase 2 historical calculation but are largely null in V1 since data ingestion is snapshot-based.)*

---

## 4. Competitor / Stores Entity (Subdocument)

**Entity Name:** `StoreRef`  
**Purpose:** References live dropshipping stores currently selling this exact product.

### Why these fields exist

| Field | Type | Description & Purpose |
|-------|------|-----------------------|
| `storeName` | `String` | The name of the competing store. |
| `url` | `String` | Direct link to the competitor's product page for intelligence gathering. |
| `price` | `Number` | The price the competitor is selling it for, helping the user competitively position their own offer. |

---

## 5. Supplier / Sourceability Entity (Subdocument)

**Entity Name:** `SupplierRef`  
**Purpose:** Connects a viral product to its actual manufacturing source (e.g., AliExpress, CJ Dropshipping), transitioning the platform from "research" to "fulfillment."

### Why these fields exist

| Field | Type | Description & Purpose |
|-------|------|-----------------------|
| `name` | `String` | Name of the supplier platform. |
| `url` | `String` | Direct link to the supplier page where the item can be purchased at wholesale, when one is available. |
| `wholesalePrice` | `Number` | The base cost to acquire the item, which alongside the market `price`, determines the `estimatedMargin`. |
