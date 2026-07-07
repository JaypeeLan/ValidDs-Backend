# Shopify App Billing — local testing

Use this when `BILLING_PROVIDER=shopify` (see `.env.example`).

## Prerequisites

1. **Shopify Partner app** with Client ID / Secret (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`).
2. **Development store** linked to your Partner account.
3. **Redirect URI** whitelisted: `http://localhost:3000/api/v1/stores/shopify/callback` (or your local API URL).
4. Backend `.env`:

```env
BILLING_PROVIDER=shopify
SHOPIFY_BILLING_TEST=true
SHOPIFY_BILLING_TRIAL_DAYS=7
FRONTEND_URL=http://localhost:3001
SHOPIFY_REDIRECT_URI=http://localhost:3000/api/v1/stores/shopify/callback
```

## Flow

1. Sign in to ValidDs (JWT).
2. **Connect store**: `GET /api/v1/stores/shopify/install?shop=your-dev-store.myshopify.com` → open `authorizeUrl` in browser → approve.
3. **List plans**: `GET /api/v1/billing/plans` — response includes `"provider": "shopify"`.
4. **Checkout**: `POST /api/v1/billing/checkout` with body `{ "plan": "explorer" }` → open returned `url` (Shopify approval page).
5. After approving, Shopify redirects to `FRONTEND_URL/billing/success?provider=shopify&plan=explorer`.
6. **Sync plan** (no webhook needed locally): `POST /api/v1/billing/shopify/sync`
7. **Verify**: `GET /api/v1/billing/subscription` — `plan`, `shopifySubscriptionId`, `billingProvider: "shopify"`.

## Webhooks (optional)

Register in Partner Dashboard → Webhooks:

- URL: `https://<tunnel>/api/v1/webhooks/shopify`
- Topic: `app_subscriptions/update`

Use `ngrok http 3000` or Shopify CLI to forward webhooks. Without webhooks, use `POST /billing/shopify/sync` after each approval.

## Cancel

`POST /api/v1/billing/subscription/cancel` with `{ "immediate": true }` when `billingProvider` is `shopify`.

## Switch back to Stripe

Set `BILLING_PROVIDER=stripe` and restart the API.
