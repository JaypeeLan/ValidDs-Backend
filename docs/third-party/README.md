# Third-Party Services — Index

This folder contains step-by-step setup guides for every external service used by the ValidDs backend.

Each guide covers:
- What the service is and why it is used
- How to create an account
- Where to get credentials or API keys
- What to put in your `.env` file
- How to verify it is working
- Free tier limits and upgrade paths

---

## Services

| Service | Purpose | Env Vars | Guide |
|---|---|---|---|
| **MongoDB Atlas** | Primary database | `MONGODB_URI`, `MONGODB_DB_NAME` | [mongodb-atlas.md](./mongodb-atlas.md) |
| **Redis (Upstash)** | Cache + image URL resolution | `REDIS_URL` | [redis.md](./redis.md) |
| **EchoTik** | TikTok Shop product data (primary ingestion source) | `ECHOTIK_USERNAME`, `ECHOTIK_PASSWORD` | — |
| **EnsembleData** | TikTok creator enrichment (post & author data) | `ENSEMBLE_API_KEY` | — |
| **SearchApi** | Google Shopping reviews + related products | `SEARCHAPI_KEY` | — |
| **TeemDrop** | Supplier catalog enrichment | `TEEMDROP_APP_KEY`, `TEEMDROP_APP_SECRET` | [teemdrop.md](./teemdrop.md) |
| **Sentry** | Error tracking | `SENTRY_DSN` | [sentry.md](./sentry.md) |
| **Prometheus + Grafana Cloud** | Metrics + dashboards | `METRICS_ENABLED`, `METRICS_PORT` | [prometheus.md](./prometheus.md) |
| **Render** | Cloud deployment | — | [render-deployment.md](./render-deployment.md) |
| **Stripe** | Billing + subscriptions | `STRIPE_SECRET_KEY_*`, `STRIPE_WEBHOOK_SECRET_*` | [stripe.md](./stripe.md) |
| **Google OAuth** | Social login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [google-oauth.md](./google-oauth.md) |

---

## Minimum Required for Local Development

1. **MongoDB Atlas** — database
2. **Redis** — caching and image URL resolution (local or hosted)
3. **EchoTik** — product data ingestion

Sentry, Prometheus, and Render are optional for local development.

---

## Minimum Required for Staging Deployment

1. MongoDB Atlas
2. Redis (e.g. Upstash)
3. EchoTik
4. EnsembleData (for creator data)
5. SearchApi (for reviews)
6. Render (deployment platform)
7. Sentry (strongly recommended — otherwise no visibility into errors)

---

## Environment Variable Quick Reference

| Variable | Service | Required |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas | Yes |
| `MONGODB_DB_NAME` | MongoDB Atlas | Yes |
| `REDIS_URL` | Redis | Yes |
| `ECHOTIK_USERNAME` | EchoTik | Yes |
| `ECHOTIK_PASSWORD` | EchoTik | Yes |
| `ENSEMBLE_API_KEY` | EnsembleData | Yes (creator enrichment) |
| `SEARCHAPI_KEY` | SearchApi | Yes (reviews) |
| `TEEMDROP_APP_KEY` | TeemDrop | No |
| `TEEMDROP_APP_SECRET` | TeemDrop | No |
| `SENTRY_DSN` | Sentry | No (but recommended) |
| `METRICS_ENABLED` | Prometheus | No |
| `METRICS_PORT` | Prometheus | No |
| `STRIPE_SECRET_KEY_TEST` | Stripe | No (billing only) |
| `GOOGLE_CLIENT_ID` | Google OAuth | No (social login only) |

See `.env.example` in the project root for the full list.

---

## EchoTik

EchoTik provides structured TikTok Shop product data — the primary ingestion source for ValidDs.

**Endpoints used:**

| Endpoint | Purpose |
|---|---|
| `POST /product/list` | Paginated products sorted by 30-day sales |
| `POST /product/comment` | Verified buyer reviews per product |
| `POST /batch/cover/download` | Exchange original volces.com image URLs for 24h temp URLs |

**Image URL note:** EchoTik image URLs (`volces.com`) expire after 24 hours. The backend stores originals in MongoDB and resolves them to temp URLs at serve time via Redis cache (20h TTL). See `src/ingestion/echotik/echotik.image.ts`.

**Quota:** EchoTik imposes request quotas. If you hit `"Usage Limit Exceeded"` during ingestion, contact EchoTik support to increase your plan quota.

---

## EnsembleData

Used to find real TikTok creators who are promoting each EchoTik product.

After each product is ingested, the pipeline calls `EnsembleClient.searchKeywordFull()` with the product name to find recent TikTok posts. The top post by view count supplies the `primaryCreator` record (handle, displayName, bio, followers, avatarUrl, tiktokPostUrl) and real engagement metrics (viewCount, likeCount, etc.).

**Rate limit:** 2-second enforced delay between all requests.

---

## SearchApi

Used to fetch Google Shopping reviews and related products for each ingested product.

Three-step flow:
1. `engine=google_shopping&q=<productName>` → extract `product_token`
2. `engine=google_product&product_token=<token>` → reviews + related products

Results are stored as `product.reviews[]` and `product.relatedProducts[]`. Non-blocking — skipped gracefully if product has no Google Shopping presence.
