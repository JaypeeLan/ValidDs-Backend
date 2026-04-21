# Data Ingestion Architecture

ValidDs sources product data via the **EchoTik pipeline** (primary) enriched by **EnsembleData** (creator resolution) and **SearchApi** (reviews + related products).

---

## Primary Pipeline — EchoTik Product Ingestion

```
EchoTik API (/product/list — sorted by 30d sales)
         ↓
   EchoTikJob.runPaginated()
         ↓
   Filter: skip off-market products (off_mark = 1)
         ↓
   EchoTikJob — fetch /product/comment per product
         ↓
   EchoTikIngestionPipeline.persistProduct()
         │
         ├─ ProductRepository.upsertEnrichedProduct()   ← MongoDB upsert, keyed externalId + source
         │
         ├─ DiscoveryService.categorizeProduct()        ← assigns discoverySections[]
         │
         ├─ Creative.countDocuments()                   ← sync creativeCounts
         │
         ├─ SearchApiService.fetchProductReviews()      ← google_shopping → google_product → reviews
         │     Non-blocking: skipped if product has no Google Shopping presence
         │
         └─ EnsembleClient.searchKeywordFull()          ← find real TikTok creator promoting product
               Non-blocking: seller remains as fallback if no creator post found
         ↓
   saved.save()
         ↓
   FreshnessService.markUpdated('product')
```

**Scheduler:** Daily at 15:00 Africa/Lagos, then every 24 hours.
**Entry point:** `src/ingestion/echotik/echotik.pipeline.ts → EchoTikIngestionPipeline.run()`
**Manual trigger:** `POST /api/v1/jobs/echotik-pipeline` (requires `X-API-Key` header)

### Multi-Region Ingestion

The daily job runs the pipeline sequentially for each region:

| Region | Daily Target |
|--------|-------------|
| US | 300 products |
| BR, MX, GB, FR, DE, ES, IT, AU, NZ | 50 products each |

### Hard Caps

| Environment | Max Products |
|---|---|
| Development | 30 |
| Staging / Production | 300 (per region run) |

### Off-Market Filter

Products with `off_mark = 1` from EchoTik are skipped entirely and counted under `productsSkipped`.

### Image URLs

EchoTik images are hosted on `echosell-images.tos-ap-southeast-1.volces.com` (volces.com). These URLs expire after 24 hours and **cannot be stored as-is**.

**Architecture:**
- **At ingestion:** original volces.com URLs are stored in MongoDB (`imageUrls`, `primaryImageUrl`)
- **At serve time:** `resolveEchoTikImageUrls()` in `src/ingestion/echotik/echotik.image.ts` exchanges them for temp URLs via `/batch/cover/download`, caching results in Redis for 20 hours (72,000s TTL)
- **Cache key pattern:** `echotik:img:<original-url>`

The product controller calls `toPlainWithImages()` which runs resolution transparently before returning any EchoTik product to a client.

### Stale Cleanup

Products that have not been re-ingested within **24 hours** are marked `status: 'stale'`. The cleanup job runs every 5 minutes but uses a 1440-minute (24h) cutoff, matching the daily ingestion cycle.

---

## Creator Enrichment — EnsembleData

After persisting each EchoTik product, the pipeline searches EnsembleData for TikTok posts mentioning the product name and overwrites `primaryCreator` with the top creator (by view count).

```
EnsembleClient.searchKeywordFull({ name: productName, days: 30 })
         ↓
   Sort posts by statistics.play_count desc → pick top post
         ↓
   Map author → primaryCreator { handle, displayName, bio, followers, avatarUrl, tiktokPostUrl, … }
         ↓
   Overwrite viewCount / likeCount / commentCount / shareCount from the creator post
```

**Fallback:** If Ensemble returns no posts or the API call fails, the EchoTik seller record remains as `primaryCreator`.

**Rate limiting:** EnsembleClient enforces a 2-second delay between requests (`RATE_LIMIT_MS = 2000`).

---

## Review & Related Product Enrichment — SearchApi

```
SearchApiService.fetchProductReviews(productName)
         │
         ├─ Step 1: GET /api/v1/search?engine=google_shopping&q=<productName>
         │          → extract shopping_results[0].product_token
         │
         └─ Step 2: GET /api/v1/search?engine=google_product&product_token=<token>
                    → reviews[]       → saved to product.reviews
                    → related_products[] → saved to product.relatedProducts
```

**Base URL:** `https://www.searchapi.io/api/v1/search`
**Env var:** `SEARCHAPI_KEY`
**Non-blocking:** skipped gracefully if product has no Google Shopping presence.

---

## Data Sources

### EchoTik (`echotik.com`)

**Env vars:** `ECHOTIK_USERNAME`, `ECHOTIK_PASSWORD`

| Endpoint | Purpose |
|---|---|
| `POST /product/list` | Paginated product listing sorted by sales |
| `POST /product/comment` | Verified buyer reviews per product |
| `POST /batch/cover/download` | Temp URL exchange for product images (24h expiry) |

**Params used for product list:**
- `product_sort_field: 5` — sort by 30-day sales
- `sort_type: 1` — descending
- `min_total_sale_30d_cnt: 50` — minimum 50 sales in last 30 days

### EnsembleData (`ensembledata.com`)

**Base URL:** `https://ensembledata.com/apis/tt`
**Env var:** `ENSEMBLE_API_KEY`

| Endpoint | Purpose |
|---|---|
| `GET /keyword/full-search` | Find TikTok posts by product name (creator enrichment) |
| `GET /hashtag/posts` | Paginated posts for a hashtag |
| `GET /post/comments` | Top comments for a post |

### SearchApi (`searchapi.io`)

**Base URL:** `https://www.searchapi.io/api/v1/search`
**Env var:** `SEARCHAPI_KEY`

| Engine | Purpose |
|---|---|
| `google_shopping` | Find product listing, extract `product_token` |
| `google_product` | Fetch reviews and related products using `product_token` |

### TeemDrop (`openapi.teemdrop.com`)

**Env vars:** `TEEMDROP_APP_KEY`, `TEEMDROP_APP_SECRET`, `TEEMDROP_BASE_URL`

Used for supplier catalog matching. Auth: `POST /openapi/createToken/v1`, then signed requests to `/openapi/product/list/v1` and `/openapi/product/detail/v1`.

---

## Creative Ingestion

After products are ingested, `CreativeService.fetchAndIngestCreatives()` finds TikTok videos associated with each product and stores them as `Creative` documents linked via `productId`.

The daily job runs creative ingestion after product ingestion, targeting **300 creative videos** total.

---

## Database Upsert

Both pipelines are **idempotent** — re-running never creates duplicates.

| Method | Key | Used by |
|---|---|---|
| `upsertEnrichedProduct()` | `externalId + source` | EchoTik pipeline |

---

## Job Schedule Summary

| Job | Interval | Run Time | Environments |
|---|---|---|---|
| EchoTik + Creative ingestion | Every 24 hours | 15:00 Africa/Lagos | Staging + Prod |
| Stale cleanup | Every 5 minutes | Immediately on boot | All |

Manual triggers (require `X-API-Key` header):
- `POST /api/v1/jobs/echotik-pipeline`
- `POST /api/v1/jobs/product-refresh`

---

## Environment Variables

```bash
# EchoTik — TikTok Shop product data
ECHOTIK_USERNAME=your_email
ECHOTIK_PASSWORD=your_password

# EnsembleData — TikTok creator data
ENSEMBLE_API_KEY=your_token

# SearchApi — Google Shopping reviews
SEARCHAPI_KEY=your_key

# TeemDrop — supplier catalog enrichment
TEEMDROP_APP_KEY=your_key
TEEMDROP_APP_SECRET=your_secret
TEEMDROP_BASE_URL=https://openapi.teemdrop.com
```

---

## Troubleshooting

| Symptom | Likely Cause | Check |
|---|---|---|
| `Usage Limit Exceeded` from EchoTik | EchoTik API quota hit | Contact EchoTik support to increase quota |
| Images not loading | volces.com temp URL expired | Check Redis cache for `echotik:img:*` keys; run pre-warm script |
| `0 reviews` on products | Product not on Google Shopping | Normal — SearchApi enrichment is best-effort |
| Creators showing seller ID not @handle | EnsembleData returned no posts | Check `ENSEMBLE_API_KEY` and product name searchability |
| `status: stale` immediately after ingest | Stale cleanup cutoff too short | Currently 1440 min (24h) — matches daily ingestion cycle |
| Products not appearing in feed | upsert keyed wrong or category invalid | Check `product.repository.ts` filter + category taxonomy |
