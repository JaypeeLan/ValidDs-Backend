# Data Ingestion Architecture

ValidDs sources product data via a unified EnsembleData-powered pipeline:

1. **Discovery Job** — follows a light-weight keyword search (e.g. 'tiktokmademebuyit') to find trending dropshipping products. Runs every 2 hours.
2. **Hashtag Pipeline** — fetches posts for specifically tracked hashtags (e.g. `#TikTokMadeMeBuyIt`) via deep cursor-based pagination. Runs every 48 hours on staging/prod.

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
**Manual trigger:** `npm run test-ingestion`

---

## Pipeline 2 — Hashtag Ingestion (48-hour cycle)

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
   RainforestService.searchAmazonProducts(productName)
   Returns: { search_results: [{ title, price, image }] }
         ↓
   ProductEnricher.mergeAndUpsert()
   → avgPrice (mean of all results), shortest title ≤ 80 chars, images[]
         ↓
   ProductRepository.upsertEnrichedProduct()   ← keyed on videoId + source
         ↓
   FreshnessService.markUpdated('product')
```

**Scheduler:** `src/jobs/index.ts` — `setInterval` every 48 hours. First run 30 s after boot. **Staging/prod only** — skipped in development.
**Entry point:** `src/ingestion/ensemble/hashtag-ingestion.pipeline.ts → HashtagIngestionPipeline.run()`
**Manual trigger:** `npm run hashtag-pipeline`

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

**Retry logic:** 3 attempts with exponential backoff (1s, 2s, 4s). Returns `null` (not a throw) if all retries fail — the pipeline continues without Rainforest data.

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

### Canonical Categories

All products are assigned to one of 10 hardcoded categories defined in `src/api/products/product.constants.ts`:

```
Beauty & Healthcare · Electronics & Gadgets · Home & Kitchen
Fashion & Accessories · Sports & Outdoors · Pet Supplies
Office Products · Automotive · Toys & Games · Food & Beverages
```

The AI is instructed to pick from this list. Any extraction that maps to an unknown category falls back to `'Electronics & Gadgets'`.

---

## Product Enrichment (`src/services/product.enricher.ts`)

`ProductEnricher.mergeAndUpsert()` combines AI + Rainforest data before writing to MongoDB:

| Field | Source | Logic |
|---|---|---|
| `title` | Rainforest | Shortest Amazon title ≤ 80 chars from top 5 results. Falls back to AI `productName`. |
| `price` | Rainforest | Average of all valid prices. `0` if no results. |
| `priceMin/Max` | Rainforest | Min/max across all results. |
| `category` | AI | `productNiche` from Gemini. |
| `imageUrls` | Rainforest | Up to 10 unique images. Falls back to TikTok thumbnail. |
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
| Hashtag Pipeline | Every 48 hours | 30s after boot | Staging + Prod only |

---

## Environment Variables

```bash
# EnsembleData — max 24 chars (enforced by their API)
ENSEMBLE_API_KEY=your_token

# Rainforest Amazon search
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
| `Rainforest returned no results` | Bad product name or API quota exceeded | Check Rainforest dashboard |
| Products not appearing in feed | Upsert keyed wrong or category invalid | Check `product.repository.ts` filter + `PRODUCT_CATEGORIES` |
