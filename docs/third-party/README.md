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
| **Redis (Upstash)** | Cache | `REDIS_URL` | [redis.md](./redis.md) |
| **EnsembleData** | TikTok creator enrichment (post & author data) | `ENSEMBLE_API_KEY` | — |
| **TeemDrop** | Supplier catalog enrichment | `TEEMDROP_APP_KEY`, `TEEMDROP_APP_SECRET` | [teemdrop.md](./teemdrop.md) |
| **Sentry** | Error tracking | `SENTRY_DSN` | [sentry.md](./sentry.md) |
| **Render** | Cloud deployment | — | [render-deployment.md](./render-deployment.md) |
| **Stripe** | Billing + subscriptions | `STRIPE_SECRET_KEY_*`, `STRIPE_WEBHOOK_SECRET_*` | [stripe.md](./stripe.md) |
| **Google OAuth** | Social login | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [google-oauth.md](./google-oauth.md) |
| **Shopify OAuth** | Connect user Shopify store + push products | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_REDIRECT_URI` | [shopify-oauth.md](./shopify-oauth.md) · [HTTP routes in endpoints.md](../endpoints.md) |

---

Shopify integration **REST paths** (install, callback, status, disconnect, push) are documented under **§8** in [`docs/endpoints.md`](../endpoints.md).

---

## Minimum Required for Local Development

1. **MongoDB Atlas** — database
2. **Redis** — caching (local or hosted)

Sentry and Render are optional for local development.

---

## Minimum Required for Staging Deployment

1. MongoDB Atlas
2. Redis (e.g. Upstash)
3. EnsembleData (for creator data, when using flows that need it)
4. Render (deployment platform)
5. Sentry (strongly recommended — otherwise no visibility into errors)

---

## Environment Variable Quick Reference

| Variable | Service | Required |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas | Yes |
| `MONGODB_DB_NAME` | MongoDB Atlas | Yes |
| `REDIS_URL` | Redis | Yes |
| `ENSEMBLE_API_KEY` | EnsembleData | Depends on feature set |
| `TEEMDROP_APP_KEY` | TeemDrop | No |
| `TEEMDROP_APP_SECRET` | TeemDrop | No |
| `SENTRY_DSN` | Sentry | No (but recommended) |
| `STRIPE_SECRET_KEY_TEST` | Stripe | No (billing only) |
| `GOOGLE_CLIENT_ID` | Google OAuth | No (social login only) |
| `SHOPIFY_API_KEY` | Shopify OAuth | No (Shopify store integration only) |
| `SHOPIFY_API_SECRET` | Shopify OAuth | No (Shopify store integration only) |
| `SHOPIFY_REDIRECT_URI` | Shopify OAuth | No (Shopify store integration only) |

See `.env.example` in the project root for the full list.

---

## EnsembleData

Used to find real TikTok creators who are promoting products surfaced by ingestion.

Where applicable, the pipeline calls `EnsembleClient.searchKeywordFull()` with the product name to find recent TikTok posts. The top post by view count can supply the `primaryCreator` record (handle, displayName, bio, followers, avatarUrl, tiktokPostUrl) and engagement metrics.

**Rate limit:** 2-second enforced delay between all requests.
