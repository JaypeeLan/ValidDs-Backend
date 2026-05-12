# Full Frontend (React)

A standalone React frontend for the ValidDs backend — styled like a real SaaS product, not a tester. Runs entirely in the browser (no npm install, no new dependencies) via React from a CDN.

## Run

From the repo root:

```bash
node tools/full-frontend/server.js
```

Then open:

- `http://localhost:4180`

## Pages

- **Discover** – Hero, trending products, hot creatives, pricing teasers.
- **Products** – Search + filters (category, discovery section, trend direction, sort, min trend score, min views, region), paginated. Rich cards show image, title, category hierarchy, brand, price, trend score & direction, views / likes / comments / shares / engagement, rating, 30-day sales, GMV, commission, creators count, AI confidence + buying intent bars, trend reason, discovery creator, hashtags, and source/region badge. Click a card or the **Details** button for a full modal with gallery, suppliers, rating sources, top TikTok comments, reviews, related products and a direct link to the original TikTok post.
- **Creatives** – Search + filters (section, ad vs organic, sort, min views, hashtag, region, category L1). Cards show thumbnail (with play indicator when a video URL is available), creator profile with avatar, followers & region, all engagement metrics, hashtags, publish date, and source badge. Details modal plays the video (when available) and shows creator bio, top comments and related videos.
- **Pricing** – Live pricing from `/billing/plans` — mode (LIVE / TEST), Stripe price, interval, features. Current plan is highlighted. Clicking a plan opens Stripe Checkout via `/billing/checkout`.
- **Account** – Email/password sign in and email-verification signup, saved products, plan and credit balance, sign out.

## Backend data used

Everything the cards show is pulled from the documented endpoints:

- `GET /api/v1/billing/plans`
- `POST /api/v1/billing/checkout`
- `GET /api/v1/billing/subscription`
- `GET /api/v1/products` (with all validator-supported query params)
- `GET /api/v1/products/:id`
- `GET /api/v1/products/categories`
- `GET /api/v1/creatives` (with all validator-supported query params)
- `GET /api/v1/creatives/:id`
- `GET /api/v1/profile/bookmarks`, `POST /api/v1/profile/bookmarks`
- `POST /api/v1/auth/register`, `POST /api/v1/auth/email/verify-code`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`

## Settings

Click the gear icon in the top bar to point the app at a different backend URL / API version. Values are persisted to `localStorage`.

## CORS

If requests fail from the browser, include this origin in the backend `CORS_ALLOWED_ORIGINS`:

- `http://localhost:4180`
