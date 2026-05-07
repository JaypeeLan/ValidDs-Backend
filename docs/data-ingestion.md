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
   EchoTikIngestionPipeline.buildEnrichedInput()
         │
         ├─ Category resolution                         ← ensureCategoriesLoaded() → 2,600+ IDs → human names
         │
         ├─ Image pipeline:
         │     1. EchoTik /batch/cover/download → exchange volces URLs for temp URLs
         │     2. ImageService.probe(primary) → verify temp URL actually serves image
         │     3. On miss: SearchApi google_images as fallback primary + gallery
         │        (keeps original volces URLs as sourcePrimaryImageUrl/sourceImageUrls
         │         so the 30-min image-refresh job can still upgrade them later)
         │
         ├─ SearchApiService.fetchProductReviews()      ← google_shopping → google_product
         │     Non-blocking: skipped if product has no Google Shopping presence
         │
         ├─ extractBrand(title, description)            ← heuristic: bracketed tokens → spec "Brand:" key
         │     Runs early so the hashtag fallback below can use the brand as a search tag
         │
         ├─ EchoTik /product/video/list (top 10 videos)  ← hashtags, views/likes/comments/shares,
         │                                                 engagementRate, thumbnailUrl (reflow_cover),
         │                                                 (video_id, user_id) candidates ranked by views
         │
         ├─ Creator+video resolution (multi-stage fallback):
         │     Stage 1/2: walk up to 5 EchoTik candidates → EnsembleData /post/info
         │                until a live post resolves → handle, avatar, bio, verified,
         │                live videoPlayUrl, live cover
         │     Stage 3:   if every candidate fails (deleted/private) OR /product/video/list
         │                returned nothing → EnsembleData /hashtag/posts using the best
         │                hashtag (first non-generic product-video tag → extracted brand
         │                → first meaningful title word). Top ranked post by play_count
         │                feeds the same author mapper.
         │     Non-blocking: if every stage fails the EchoTik seller remains as primaryCreator.
         │
         └─ EnsembleClient.getUserInfo(handle)           ← follower_count, following_count,
               (only when a handle was resolved)           total_likes (heart_count). /post/info
                                                           and /hashtag/posts return follower=0
                                                           in their trimmed author block — this call
                                                           is the sole source of real follower stats.
         ↓
   ProductRepository.upsertEnrichedProduct()            ← Mongo upsert keyed externalId + source
         ↓
   DiscoveryService.categorizeProduct()                 ← assigns discoverySections[]
         ↓
   Creative.countDocuments()                            ← syncs creativeCounts
         ↓
   saved.save()
         ↓
   FreshnessService.markUpdated('product')
```

**Scheduler:** Daily at 00:00 Africa/Lagos (midnight), then every 24 hours.
**Entry point:** `src/ingestion/echotik/echotik.pipeline.ts → EchoTikIngestionPipeline.run()`
**Manual triggers** (all require `X-API-Key` header):
- `POST /api/v1/jobs/product-ingestion` — full multi-region daily run (same code path as the 00:00 cron)
- `POST /api/v1/jobs/echotik-pipeline` — single-region ad-hoc run

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

EchoTik cover images live on `echosell-images.tos-ap-southeast-1.volces.com` and expire ~24 hours after EchoTik resolves them. Pipeline behaviour:

1. **At ingest:** the raw volces URL is exchanged via `/batch/cover/download` for a temp CDN URL. The temp URL is stored in `primaryImageUrl` + `imageUrls[]`, while the original volces URL is preserved in `sourcePrimaryImageUrl` + `sourceImageUrls[]` so the 30-minute image-refresh cron can upgrade it again later.
2. **Probe:** `ImageService.probe()` fires a `HEAD` request (with a tiny `GET Range: 0-0` fallback) and confirms the response is a real `image/*` — some EchoTik URLs return 200 with an HTML error body when the signature is already dead.
3. **Fallback to SearchApi:** if the probe fails or EchoTik returned no resolvable image, `ImageService.findProductImages(title)` queries SearchApi `google_images` and uses those URLs as the primary + gallery. Source volces URLs are still kept on the doc so freshness can be restored later.
4. **Redis cache:** resolved temp URLs are cached for 20 hours under `echotik:img:<original-url>` to amortise `/batch/cover/download` calls across requests and concurrent ingests.
5. **Serve time:** the product controller calls `toPlainWithImages()` → `resolveEchoTikImageUrls()` to upgrade any stored volces URL to a live temp URL before responding.

### Stale Cleanup

Products that have not been re-ingested within **24 hours** are marked `status: 'stale'`. The cleanup job runs every 5 minutes but uses a 1440-minute (24h) cutoff, matching the daily ingestion cycle.

---

## Engagement + Creator Enrichment — multi-stage fallback

For every product we ingest we want **(a)** the real TikTok engagement metrics, **(b)** a resolved `primaryCreator` with working handle/avatar/followers, and **(c)** a playable TikTok CDN `videoPlayUrl`. The pipeline uses three stages to achieve near-100% coverage even when individual TikTok posts are deleted or private:

```
Stage 1 — EchoTik /product/video/list (engagement metrics, always applied)
───────────────────────────────────────────────────────────────────────────
EchoTikClient.getProductVideos(productId, region, page=1, pageSize=10)
         ↓
   Sort response by total_views_cnt desc
         ↓
   Apply counters from the top video (authoritative even if the post is gone):
     • hashtags          ← hash_tag + video_desc (regex #tag)
     • viewCount         ← total_views_cnt
     • likeCount         ← total_digg_cnt
     • commentCount      ← total_comments_cnt
     • shareCount        ← total_shares_cnt
     • engagementRate    ← (likes + comments + shares) / views
     • thumbnailUrl      ← reflow_cover       (volces CDN)
     • primaryCreator.tiktokUserId  ← user_id
   Retain all 10 (video_id, user_id) pairs as candidates for stage 2.

Stage 2 — Walk EchoTik candidates through EnsembleData /post/info
───────────────────────────────────────────────────────────────────────────
for each candidate (up to MAX_VIDEO_CANDIDATES = 5):
  EnsembleClient.getPostInfo("https://www.tiktok.com/@/video/{video_id}")
    on success → applyEnsemblePost() fills:
       primaryCreator { handle, displayName, bio, region, verified, avatarUrl,
                        tiktokUserId, tiktokPostUrl }
       videoPlayUrl   ← post.video.play_addr.url_list[0]    (live signature)
       thumbnailUrl   ← post.video.cover.url_list[0]         (if empty)
    break out of loop

Stage 3 — Hashtag fallback (only if every stage 2 candidate missed)
───────────────────────────────────────────────────────────────────────────
tag = pickFallbackHashtag(
         hashtags extracted from stage 1,      # first non-generic
         aiIntelligence.brand,                 # extracted earlier in pipeline
         productName                           # first meaningful word, len ≥ 4
       )
         ↓
EnsembleClient.getHashtagPosts(tag, 0)
         ↓
   Filter to posts with author.unique_id, sort by statistics.play_count desc, take top 5
         ↓
   First candidate whose applyEnsemblePost() returns true wins.
   /hashtag/posts already ships full post data — no second call needed.

Follower enrichment (always, when a handle was resolved)
───────────────────────────────────────────────────────────────────────────
EnsembleClient.getUserInfo(primaryCreator.handle)
         ↓
   Overwrites only the stats the trimmed post-level author block lacks:
     • followers  ← data.stats.followerCount
     • following  ← data.stats.followingCount
     • totalLikes ← data.stats.heartCount
   (plus upgrades displayName/bio/avatar/verified/region/uid if fuller)
```

**Why three stages?** The top EchoTik video is the strongest single signal but it breaks on ~5-10% of products (post deleted, account private, region-locked). Walking 5 candidates raises hit rate to ~99%; the hashtag fallback catches the very long tail and the edge case where `/product/video/list` returns nothing at all.

**Why the weird `@/video/{id}` URL?** EchoTik's `/product/video/list` never returns the TikTok `@handle` — only a raw `user_id`. EnsembleData's `/post/info` refuses URLs in the shape `/video/{id}` (no handle) but accepts the placeholder `@/video/{id}` and still resolves the full author block. Once EnsembleData answers, `applyEnsemblePost()` rewrites `tiktokPostUrl` with the real `@handle/video/{id}` form.

**Why a second `/user/info` call?** Both `/post/info` and `/hashtag/posts` return a trimmed post-level author block whose `follower_count` is always `0`. The authoritative counts live under `data.stats.followerCount` in `/user/info`. One extra call per product is the cost of real follower numbers, which are central to the creator quality signal.

**Why not `/keyword/full-search`?** It is unreliable on long product names (15s+ timeouts, empty results) and rate-limited to one call every 2s. Walking 5 targeted `/post/info` calls is deterministic, faster, and cheaper.

**TikTok CDN expiry:** `play_addr` URLs from `/product/video/list` are stale by design — EchoTik crawls them days-to-weeks in advance and signatures expire ~35 days later (observed). We **do not trust or persist** EchoTik's `play_addr`; only the `video_id`. The live URL always comes from EnsembleData, which signs fresh.

**Rate limiting:** EnsembleClient enforces a 2-second delay between requests (`RATE_LIMIT_MS = 2000`). Worst-case budget per product: 5 `/post/info` + 1 `/hashtag/posts` + 1 `/user/info` = 14 s. Typical (top video resolves): 1 `/post/info` + 1 `/user/info` = 4 s.

---

## Brand Extraction

`aiIntelligence.brand` is populated at ingest by a local heuristic — no extra API call:

1. Bracketed tokens in `product_name` (e.g. `"[NEW] [medicube] PDRN Pink Collagen …"` → `medicube`). Marketing-only tokens (`NEW`, `HOT`, `SALE`, `LIMITED`, `BESTSELLER`, `PRO`, `PLUS`, …) and numeric/unit tokens (`10g`, `2 PACK`) are skipped.
2. `Brand:` or `Brand Name:` keys parsed out of the description (EchoTik `specification` is flattened into the description string upstream).
3. `undefined` if nothing confident — never a guess.

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
| `POST /product/video/list` | Top TikTok videos driving sales per product — source of hashtags, engagement counts, thumbnail, video_id + user_id for the `/post/info` lookup |
| `POST /batch/cover/download` | Temp URL exchange for product / thumbnail images (≈24h expiry) |
| `GET /category/l1` · `/l2` · `/l3` | Category taxonomy (cached in Redis for 7 days, 2,600+ IDs) |

**Params used for product list:**
- `product_sort_field: 5` — sort by 30-day sales
- `sort_type: 1` — descending
- `min_total_sale_30d_cnt: 50` — minimum 50 sales in last 30 days

### EnsembleData (`ensembledata.com`)

**Base URL:** `https://ensembledata.com/apis/tt`
**Env var:** `ENSEMBLE_API_KEY`

| Endpoint | Purpose |
|---|---|
| `GET /post/info` | Targeted post lookup by TikTok URL — primary source of `primaryCreator` on every EchoTik product, and of live `videoPlayUrl` used by the creative refresh path |
| `GET /user/info?username=<handle>` | Follower / following / total-likes enrichment on the resolved creator — only endpoint that returns real counts (`data.stats.followerCount`); `/post/info` and `/hashtag/posts` return `follower_count = 0` in their trimmed author blocks |
| `GET /hashtag/posts` | Paginated posts for a hashtag — used both by the creative ingestion pipeline AND by the product pipeline as the stage-3 creator fallback when every EchoTik video candidate is dead |
| `GET /post/comments` | Top comments for a post |
| `GET /keyword/full-search` | **Deprecated for product ingest.** Kept around for the legacy hashtag pipeline only; unreliable on long product names and rate-limited to one call per 2s |

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

`CreativeService.fetchAndIngestCreatives()` finds TikTok videos associated with each product via EnsembleData keyword search and stores them as `Creative` documents linked via `productId`.

**Scheduler:** every 12 hours at **00:00 and 12:00 Africa/Lagos**.
**Per-run target:** up to **500 new creative videos** (root + related).
**Entry point:** `src/jobs/index.ts → runCreativeIngestionJob()`
**Manual trigger:** `POST /api/v1/jobs/creative-ingestion` (requires `X-API-Key` header)

Each run walks products ordered by `lastIngestedAt` ASC, so the oldest data is refreshed first. Because `CreativeService.mapAndSave` now overwrites existing video slots, this job doubles as a TikTok CDN URL refresh pass — creatives it revisits get fresh `videoPlayUrl`, `thumbnailUrl`, `creator.avatarUrl`, and `metrics` values.

### Lazy CDN URL refresh

TikTok CDN signatures expire after ~1–6 hours. Two backstops ensure users rarely hit an expired URL:

1. **On-demand** — the `/creatives/:id/video` and `/creatives/:id/thumbnail` proxy endpoints kick off a background `CreativeService.refreshCreativeMedia(id, index)` whenever the upstream CDN rejects a stored URL. A 2-minute in-memory dedupe prevents duplicate refreshes for the same slot.
2. **Scheduled** — the 12-hour creative ingestion job described above refreshes URLs for every creative it revisits.

### Bulk refresh script

To refresh every creative in the DB at once (useful after a prolonged outage):

```bash
npm run ingest-creatives -- --refresh
```

Optional flags:

- `--concurrency=<n>` — parallel workers (default 2)
- `--limit=<n>` — cap the number of creatives processed
- `--only-id=<objectId>` — refresh a single creative

---

## Database Upsert

Both pipelines are **idempotent** — re-running never creates duplicates.

| Method | Key | Used by |
|---|---|---|
| `upsertEnrichedProduct()` | `externalId + source` | EchoTik pipeline |

---

## Job Schedule Summary

All schedules are anchored to **Africa/Lagos** (UTC+1). No boot-time ingestion — jobs only fire at their next scheduled slot.

| Job | Interval | Run Time | Target | Environments |
|---|---|---|---|---|
| Product ingestion | Every 24 hours | 00:00 Africa/Lagos | US 300 · other regions 50 | Staging + Prod |
| Creative ingestion | Every 12 hours | 00:00 / 12:00 Africa/Lagos | +500 new videos per run | Staging + Prod |
| Stale cleanup | Every 5 minutes | Immediately on boot | — | All |
| EchoTik image refresh | Every 30 minutes | Immediately on boot | 100 products/batch | All |

Manual triggers (require `X-API-Key` header):
- `POST /api/v1/jobs/product-ingestion` — run the daily product job on demand
- `POST /api/v1/jobs/creative-ingestion` — run the 12-hour creative job on demand
- `POST /api/v1/jobs/echotik-pipeline` — single-region EchoTik top-up
- `POST /api/v1/jobs/product-refresh` — legacy hashtag-based pipeline
- `POST /api/v1/jobs/stale-cleanup` — force the stale cleanup pass

Status: `GET /api/v1/jobs/status` returns all timers, last-run timestamps, outcomes, and the wall-clock schedule each job runs on.

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
| Creators showing seller name not @handle | All 5 EchoTik video candidates failed `/post/info` AND the hashtag fallback also missed — log shows `No creator resolved for product` | Check `ENSEMBLE_API_KEY`; inspect `/product/video/list` for the `productId`; check that the product has at least one non-generic hashtag or an extractable brand |
| Creator has real handle but `followers: 0` | `/user/info` call failed (rate limit, 404 on renamed account) | Log line `EnsembleData /user/info failed` will be present — re-run ingest or wait for next daily cycle |
| Product has `0` engagement counts | EchoTik `/product/video/list` returned no videos for that productId | Expected for brand-new products with no TikTok creators yet |
| `status: stale` immediately after ingest | Stale cleanup cutoff too short | Currently 1440 min (24h) — matches daily ingestion cycle |
| Products not appearing in feed | upsert keyed wrong or category invalid | Check `product.repository.ts` filter + category taxonomy |
| `categoryL1: "Category 600028"` showing in responses | Raw ID leaking — legacy doc or taxonomy not loaded at ingest | `await ensureCategoriesLoaded()` runs at pipeline start; response formatters also call `sanitiseCategoryFields()` to rewrite legacy strings on the fly |
| `aiIntelligence.brand` is `undefined` | No bracketed brand in the title and no `Brand:` key in description | Expected when EchoTik's seller didn't tag a brand — never guess |
