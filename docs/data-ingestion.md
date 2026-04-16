# Data Ingestion Architecture

ValidDs sources product data via a unified EnsembleData-powered pipeline:

1. **Discovery Job** — follows a light-weight keyword search (e.g. 'tiktokmademebuyit') to find trending dropshipping products. Runs every 2 hours.
2. **Hashtag Pipeline** — fetches posts for specifically tracked hashtags (e.g. `#TikTokMadeMeBuyIt`) via deep cursor-based pagination. Runs every 4 hours on staging/prod.

---

## Pipeline 1 — Discovery Job (2-hour cycle)

```
EnsembleData API (Keyword Search)
         ↓
   IngestionOrchestrator.run()
         ↓
   transformEnsemblePosts() → NormalizedPost[]
         ↓
   ProductExtractor.extractBatch()   ← DeepSeek / OpenAI
         ↓
   ProductEnricher.mergeAndUpsert()
         ↓
   FreshnessService.markUpdated()
```

**Scheduler:** `src/jobs/index.ts` — `setInterval` every 2 hours, first run 10 s after boot.
**Entry point:** `src/jobs/product-refresh.job.ts → runProductRefreshJob()`
**Manual trigger:** `POST /api/v1/jobs/product-refresh` (requires `X-API-Key` header)

---

## Deployment — Running on Render (Free Tier)

On Render's Free Tier, the service spins down after 15 minutes of inactivity. This clears internal `setInterval` timers. To ensure ingestion runs reliably:

1.  **Use an external cron service** (e.g. [cron-job.org](https://cron-job.org)) to ping the trigger endpoints.
2.  **Endpoints available:**
    - `POST /api/v1/jobs/product-refresh` (Run every 2 hours)
    - `POST /api/v1/jobs/hashtag-pipeline` (Run every 4 hours)
3.  **Authentication:** Add the header `X-API-Key: YOUR_INTERNAL_API_KEY`.
4.  **Benefits:** This wakes up the Render instance AND triggers the job regardless of user traffic.

---

## Pipeline 2 — Hashtag Ingestion (4-hour cycle)

```
TRACKED_HASHTAGS (src/ingestion/ensemble/hashtag.constants.ts)
         ↓
   EnsembleClient.getHashtagPosts()   ← cursor-based pagination
   Response: { data: { nextCursor, data: EnsemblePost[] } }
         ↓
   Filter: skip posts with viewCount < 50,000
         ↓
   EnsembleClient.getPostComments()   ← per post
         ↓
   transformEnsemblePosts() + transformEnsembleComments()
         ↓
    ProductExtractor.extractFromPost(post, comments)  ← Gemini AI
    Returns: { productName, productNiche, trendScore, sentimentSummary, buyingIntentScore, ... }
          ↓
    TeemDropService.findProductDetailByName(productName)
    Returns: { productId, productNameEn, description, productMinPrice, productMaxPrice, images }
          ↓
    RainforestService.searchAmazonProducts(productName)   ← fallback only
    Returns: { search_results: [{ title, price, image, recent_sales, link }] }
          ↓
    ProductEnricher.mergeAndUpsert()
    → price uses TeemDrop `productMaxPrice` when available
    → verifiedUnitsSold comes from Rainforest `recent_sales` or grounded web research
    → Fallback: Web Search (AliExpress/Walmart) if supplier sales is 0
          ↓
    ProductRepository.upsertEnrichedProduct()   ← keyed on videoId + source
          ↓
    FreshnessService.markUpdated('product')
```

**Scheduler:** `src/jobs/index.ts` — `setInterval` every 4 hours. **Staging/prod only** — disabled automatically in development to conserve credits.
**Entry point:** `src/ingestion/ensemble/hashtag-ingestion.pipeline.ts → HashtagIngestionPipeline.run()`
**Manual trigger:** `npm run hashtag-pipeline`

### Hard Caps on Processed Posts
To tightly control API spend (AI extractions + Amazon queries), the pipeline forcibly stops after processing a fixed limit of valid posts per run:
- **Staging / Production**: Capped at **50 posts** (`MAX_POSTS_PROD`).
- **Development**: Capped at **40 posts** (`MAX_POSTS_DEV`).

### View Count Filter

Posts with fewer than **50,000 views** are skipped before any AI call. This is the single biggest cost-control lever — low-engagement posts are unlikely to drive product discovery and would waste Gemini tokens.

### Pagination

EnsembleData returns a `nextCursor` in each response. The job follows it until:
- `nextCursor` is `null` (API has no more pages), or
- `cursor > MAX_CURSOR` (dev: 40 = 3 pages; prod: 4000 = up to ~200 pages)

### Adding a New Tracked Hashtag

Edit **one file**:

```typescript
// src/ingestion/ensemble/hashtag.constants.ts
export const TRACKED_HASHTAGS = [
  'TikTokMadeMeBuyIt',
  'AmazonFinds',          // ← add here
] as const;
```

The pipeline will automatically scrape all hashtags in the array on the next run.

---

## Data Sources

### EnsembleData (`ensembledata.com`)

**Base URL:** `https://ensembledata.com/apis/tt`
**Auth:** `token` query parameter (max 24 chars — enforced by their API)
**Env var:** `ENSEMBLE_API_KEY`

| Endpoint | Purpose | Params |
|---|---|---|
| `GET /hashtag/posts` | Paginated posts for a hashtag | `name`, `cursor`, `token` |
| `GET /tt/post/comments` | Top comments for a post | `aweme_id`, `token` |
| `GET /tt/keyword/search` | Keyword post search | `keyword`, `cursor`, `token` |

**Rate limiting:** 2-second enforced delay between all requests (`RATE_LIMIT_MS = 2000` in `ensemble.client.ts`).

### TeemDrop API (`openapi.teemdrop.com`)

**Base URL:** `https://openapi.teemdrop.com`
**Env vars:** `TEEMDROP_APP_KEY`, `TEEMDROP_APP_SECRET`, `TEEMDROP_BASE_URL`, `TEEMDROP_USER_AGENT`

Auth flow used by `src/services/teemdrop.service.ts`:

1. `POST /openapi/createToken/v1`
2. Use the returned token to sign:
   - `POST /openapi/product/list/v1`
   - `POST /openapi/product/detail/v1`

The service pages through the first few catalog pages, scores product titles against the extracted product name, and fetches `product/detail` only for the best confident match.

**Live verification note:** On April 15, 2026, requests from this workspace were blocked by Cloudflare when using a plain default `curl` user agent. The same requests succeeded with `Accept: application/json` and `User-Agent: PostmanRuntime/7.43.0`.

### Rainforest API (`rainforestapi.com`)

**Endpoint:** `https://api.rainforestapi.com/request`
**Env var:** `RAINFOREST_API_KEY`

Hardcoded search params:

| Param | Value |
|---|---|
| `type` | `search` |
| `amazon_domain` | `amazon.com` |
| `sort_by` | `bestseller_rankings` |
| `page` | `1` |
| `number_of_results` | `20` |
| `include_products_count` | `5` |
| `exclude_sponsored` | `false` |

**Behavior in this repo:** Single attempt. Returns `null` (not a throw) if the call fails — the pipeline continues without Rainforest data and only uses it as a fallback when TeemDrop could not resolve a match.

---

## AI Extraction

### ProductExtractor (`src/services/product.extractor.ts`)

Uses Gemini AI to analyse a TikTok post + its top comments and return structured product data.

**Input:**
```typescript
extractFromPost(post: NormalizedPost, comments: NormalizedComment[]): Promise<ExtractedProduct | null>
```

**Returns `null` if:**
- The post is not clearly promoting a product
- AI confidence is below threshold

**Output shape (`ExtractedProduct`):**
```typescript
{
  productName: string;          // Used as Amazon search term
  productNiche: string;         // Must match a PRODUCT_CATEGORIES entry
  productDescription: string;
  trendDirection: 'rising' | 'peaked' | 'saturating' | 'unknown';
  trendScore: number;           // 0-100
  trendReason: string;
  extractionConfidence: number; // 0-1
  sentimentSummary?: string;
  buyingIntentScore?: number;   // 0-10
}
```

### 3-Level TikTok Shop Taxonomy

All products are assigned to a canonical 3-level TikTok Shop category path:
**Primary Category / Sub Category / Category Leaf**

Example: \`Beauty & Personal Care / Skincare / Skin Care Kits\`

The extraction engine maps niches to these paths:
- **Beauty & Personal Care** (Skincare, Makeup, Hair, etc.)
- **Electronics & Gadgets**
- **Home & Living**
- **Fashion & Accessories**
- **Sports & Outdoors**
- **Pet Supplies**
- **Toys & Games**
- **Automotive**
- **Tools & Home Improvement**
- **Food & Beverages**
- **Baby & Maternity**
- **Health & Wellness**

The AI generates a `productNiche`, which the `matchCategoryPath` utility maps into the full formal TikTok Shop hierarchy.

---

## Product Enrichment (`src/services/product.enricher.ts`)

`ProductEnricher.mergeAndUpsert()` combines AI + supplier data before writing to MongoDB:

| Field | Source | Logic |
|---|---|---|
| `title` | TeemDrop / Rainforest | Uses `productNameEn` from TeemDrop when available, otherwise the best Rainforest title, then falls back to AI `productName`. |
| `price` | TeemDrop / Rainforest | Uses TeemDrop `productMaxPrice` when available. Otherwise uses Rainforest average price. `0` if no provider yields a price. |
| `unitsSold` | **Verified** | Extracted from Rainforest `recent_sales` when available. Falls back to grounded web research. |
| `suppliers` | Multiple | TeemDrop or Amazon source entry plus search links for AliExpress/Alibaba. Verified web research is inserted at the top when used. |
| `categoryPath` | Utility | Resolved via \`matchCategoryPath(extraction.productNiche)\`. |
| `imageUrls` | TeemDrop / Rainforest | Uses TeemDrop gallery images first, then Rainforest images, then web/TikTok fallbacks. |
| `trendScore` | AI | Direct from `ExtractedProduct`. |
| `sentimentSummary` | AI | Direct from `ExtractedProduct`. |
| `totalViews` | TikTok post | `NormalizedPost.viewCount`. |

---

## Database Upsert

Both pipelines are **idempotent** — running them twice doesn't create duplicates.

| Method | Key | Used by |
|---|---|---|
| `upsertFromExtraction()` | `videoId + source` | Creative Center pipeline |
| `upsertEnrichedProduct()` | `videoId + source` | Hashtag pipeline |

---

## Job Schedule Summary

| Job | Interval | First Run | Environments |
|---|---|---|---|
| Discovery Job | Every 2 hours | 10s after boot | All |
| Stale Cleanup | Every 30 minutes | Immediately | All |
| Hashtag Pipeline | Every 4 hours | Only via cron | Staging + Prod only |

---

## Environment Variables

```bash
# EnsembleData — max 24 chars (enforced by their API)
ENSEMBLE_API_KEY=your_token

# TeemDrop catalog enrichment
TEEMDROP_APP_KEY=your_key
TEEMDROP_APP_SECRET=your_secret

# Rainforest Amazon fallback
RAINFOREST_API_KEY=your_key

# AI Providers (at least one required)
DEEPSEEK_API_KEY=optional
OPENAI_API_KEY=optional

# Primary data collection
```

---

## Troubleshooting

| Symptom | Likely Cause | Check |
|---|---|---|
| `422 Unprocessable Entity` from EnsembleData | `ENSEMBLE_API_KEY` > 24 chars | `grep ENSEMBLE_API_KEY .env` |
| `0 posts fetched` from hashtag | Wrong response field path | Check `ensemble.client.ts` parser |
| `0 AI extractions` | No AI key set, or all posts below 50k views | Check `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` and view counts |
| `TeemDrop and Rainforest returned no results` | No confident TeemDrop match and no usable Rainforest response | Check TeemDrop credentials first, then Rainforest quota |
| Products not appearing in feed | Upsert keyed wrong or category invalid | Check `product.repository.ts` filter + `PRODUCT_CATEGORIES` |
