# Stripe — Setup Guide

## What It Is

Stripe is the payment gateway powering ValidDs's subscription billing. It handles subscription checkout, free trials, renewals, and cancellations via webhooks that automatically update the user's plan and credit balance.

## Payment Flow

```
1. User visits /pricing  → frontend calls GET /api/v1/billing/plans
                              returns plan features, credit limits, Stripe price data, trial days

2. User clicks "Start Trial" → frontend calls POST /api/v1/billing/checkout
                              body: { "plan": "explorer" | "pro" | "premium" }
                              returns: { "url": "https://checkout.stripe.com/..." }

3. Frontend redirects browser to url

4. User enters card details on Stripe's hosted checkout page
   (no charge yet — 7-day free trial starts immediately)

5. Stripe fires checkout.session.completed webhook → backend provisions the plan
   User's plan and creditBalance are updated in MongoDB
   A planUpgraded WebSocket event is emitted to the frontend

6. Stripe redirects user back to:
   Success → FRONTEND_URL/billing/success?session_id=cs_...
   Cancel  → FRONTEND_URL/billing

7. Frontend success page calls GET /api/v1/auth/me or GET /api/v1/billing/subscription
   to refresh user state (plan is already updated in DB at this point)

8. After 7 days, Stripe charges the card and fires invoice.paid → credits are refreshed
9. On cancellation, customer.subscription.deleted → user is downgraded to free
```

---

## Plans

| Plan     | Credits/month | Price (set in Stripe) | Trial |
|----------|--------------|----------------------|-------|
| Explorer | 15,000        | Set in Dashboard      | 7 days |
| Pro      | 60,000        | Set in Dashboard      | 7 days |
| Premium  | 200,000       | Set in Dashboard      | 7 days |

`free` is the default plan with 1,000 credits — not purchasable, users start here and are returned here on cancellation.

---

## Backend Endpoints

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /api/v1/billing/stripe-config` | Public | Returns `{ publishableKey, mode }` for Stripe.js |
| `GET /api/v1/billing/plans` | Public | Returns plan features + live Stripe price data + trial days |
| `POST /api/v1/billing/checkout` | Required | Creates Checkout Session, returns `{ url, sessionId }` |
| `GET /api/v1/billing/subscription` | Required | Current plan, credits, Stripe IDs, last 10 transactions |
| `POST /api/v1/webhooks/stripe` | Stripe signature | Handles all Stripe lifecycle events |

---

## Step 1: Create a Stripe Account

1. Go to [https://stripe.com](https://stripe.com) and create an account.
2. Keep **Test Mode** enabled while developing (toggle top-right).

---

## Step 2: Create Products and Prices

Create three recurring subscription products in **Product Catalog → Add Product**:

- **Explorer** — monthly recurring price
- **Pro** — monthly recurring price
- **Premium** — monthly recurring price

For each product: click on it → copy the **Price API ID** (`price_1...`).

> Free trial is applied by the backend (`trial_period_days: 7`) — you do **not** need to configure trials in the Stripe Dashboard.

---

## Step 3: API Keys

**Developers → API keys:**
- `pk_test_...` — Publishable key (used by Stripe.js on the frontend)
- `sk_test_...` — Secret key (backend only, never expose)

---

## Step 4: Configure Webhooks

### Local development

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
# Copy the whsec_... output → set as STRIPE_WEBHOOK_SECRET_TEST
```

### Production (Render / VPS)

In Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
- URL: `https://<your-api-host>/api/v1/webhooks/stripe`
- Events to listen for:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- Copy the `whsec_...` secret → set as `STRIPE_WEBHOOK_SECRET_LIVE`

---

## Step 5: Environment Variables

```env
# Test (NODE_ENV != production)
STRIPE_SECRET_KEY_TEST=sk_test_xxxx
STRIPE_PUBLISHABLE_KEY_TEST=pk_test_xxxx
STRIPE_WEBHOOK_SECRET_TEST=whsec_xxxx    # from stripe listen (local) or Dashboard (prod)

# Live (NODE_ENV=production)
STRIPE_SECRET_KEY_LIVE=sk_live_xxxx
STRIPE_PUBLISHABLE_KEY_LIVE=pk_live_xxxx
STRIPE_WEBHOOK_SECRET_LIVE=whsec_xxxx

# Price IDs — test
STRIPE_PRICE_ID_EXPLORER_TEST=price_1TMEjiFYFVzQsP3l4Ec0kH6V
STRIPE_PRICE_ID_PRO_TEST=price_1TMEkaFYFVzQsP3lz9SitrGw
STRIPE_PRICE_ID_PREMIUM_TEST=price_1TMElIFYFVzQsP3lTUf1opXQ

# Price IDs — live (fill when going to production)
STRIPE_PRICE_ID_EXPLORER_LIVE=
STRIPE_PRICE_ID_PRO_LIVE=
STRIPE_PRICE_ID_PREMIUM_LIVE=

# Where to redirect after checkout
FRONTEND_URL=http://localhost:3001    # e.g. https://app.validds.com in prod
```

---

## Deploying to Render

1. Set all env vars above in Render's **Environment** panel.
2. Register the live webhook endpoint in Stripe Dashboard pointing to your Render API URL.
3. Set `NODE_ENV=production` to switch from test → live keys automatically.

---

## Security Notes

- **Never log or expose** `STRIPE_SECRET_KEY_*` or `STRIPE_WEBHOOK_SECRET_*`.
- The webhook route is registered **before** `express.json()` with `express.raw({ type: 'application/json' })` to preserve the raw body for signature verification.
- Always use HTTPS in production — Stripe will not deliver webhooks to plain HTTP.

---

## Troubleshooting

**`Webhook signature verification failed`**
Make sure `STRIPE_WEBHOOK_SECRET_TEST` matches the secret output by `stripe listen`, not the Dashboard secret.

**User plan not updating after payment**
Check webhook logs for `Plan provisioned`. If it's there, the DB is updated — the frontend just needs to call `GET /api/v1/auth/me` to refresh its cached user state after the success redirect.

**`Stripe price ID for plan "X" is not configured`**
The `STRIPE_PRICE_ID_<PLAN>_TEST` env var is missing or empty for that plan.
