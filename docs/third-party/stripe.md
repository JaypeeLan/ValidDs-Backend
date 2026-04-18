# Stripe — Setup Guide

## What It Is

Stripe is the payment gateway powering ValidDs's **Hybrid Tiered + Credit Pricing System**. It handles user subscriptions, generates payment links, limits fraud, and issues webhooks to our backend to natively update user states and unlock credit allotments upon payment success.

The flow works like this:
1. User selects a tier (Starter, Validator, Scale) on the frontend.
2. Frontend redirects the user to a Stripe Checkout Session via the backend.
3. User completes payment.
4. Stripe fires a `checkout.session.completed` (or `invoice.paid`) webhook to our backend.
5. The backend (`BillingService`) provisions the user's `creditBalance`, updates their `plan`, and stores their `stripeSubscriptionId` and `stripeCustomerId`.

---

## Step 1: Create a Stripe Account

1. Go to [https://stripe.com](https://stripe.com) and create an account.
2. You will start in **Test Mode** (look for the toggle in the upper right). Keep this enabled while developing locally.

---

## Step 2: Create Products and Prices

ValidDs uses specific subscription products. You'll need to create these products in the Stripe Dashboard:

1. Navigate to **Product Catalog** → **Add Product**.
2. Create the tiers outlined in your pricing model:
   - **Starter Plan**: $49.00 / month
   - **Validator Plan**: $99.00 / month
   - **Scale Plan**: $199.00 / month
3. Once created, click on each product to view its **Pricing**.
4. Copy the **API ID** for the price (it looks like `price_1Pabcxyz...`). You will need to map these inside the application or frontend to trigger correct checkout amounts.

---

## Step 3: Obtain API Keys

1. In your Stripe Dashboard, go to **Developers** → **API keys**.
2. Locate your **Publishable key** (`pk_test_...` or `pk_live_...`). This goes to the frontend.
3. Locate your **Secret key** (`sk_test_...` or `sk_live_...`). This goes to the backend.

---

## Step 4: Configure Local Webhooks

Stripe must notify the backend when payments occur so we can provision credits.

1. Install the Stripe CLI: [https://stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)
2. Log in using `stripe login`.
3. Forward webhooks to your local server by running:
   ```bash
   stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
   ```
4. The CLI will output a webhook signing secret (it looks like `whsec_...`). Copy this.

For production, you will configure a live Webhook Endpoint inside **Developers** → **Webhooks** in the Stripe Dashboard, pointing to your live URL (e.g., `https://api.validds.com/api/v1/webhooks/stripe`), extracting the live `whsec_...` secret.

---

## Step 5: Set Your Environment Variables

Add these to your `.env` file for the backend (see `.env.example`):

```env
STRIPE_SECRET_KEY_TEST=sk_test_xxxx
STRIPE_PUBLISHABLE_KEY_TEST=pk_test_xxxx
STRIPE_WEBHOOK_SECRET_TEST=whsec_xxxx   # from `stripe listen` locally, or Dashboard webhook secret in prod
```

For **production** (`NODE_ENV=production`), the server uses `STRIPE_SECRET_KEY_LIVE`, `STRIPE_PUBLISHABLE_KEY_LIVE`, and `STRIPE_WEBHOOK_SECRET_LIVE` instead.

> **Note:** Do NOT commit secret keys. Use Render/host env var UI for staging/production.

### Implemented backend routes

| Route | Purpose |
|-------|---------|
| `GET /api/v1/billing/stripe-config` | Returns `{ publishableKey, mode, secretKeyConfigured }` for Stripe.js |
| `POST /api/v1/webhooks/stripe` | Verifies Stripe signature and acknowledges events (`checkout.session.completed` is logged; user provisioning TODO) |

---

## Security Notes

- **Never log or expose** the `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.
- The webhook route is registered **before** `express.json()` with `express.raw({ type: 'application/json' })` so signatures verify against `STRIPE_WEBHOOK_SECRET_TEST` / `STRIPE_WEBHOOK_SECRET_LIVE`.
- In production, always mandate HTTPS. Stripe will refuse to send secure payloads to raw HTTP endpoints.

---

## Troubleshooting

**Webhook signature verification failed**
Make sure you are passing the exact `STRIPE_WEBHOOK_SECRET_TEST` (or `_LIVE`) matching the environment. The app registers the webhook **before** `express.json()` so the raw body is preserved.

**Products aren't returning valid Customer records**
Ensure your Stripe Checkout call explicitly passes the `client_reference_id` (usually your local MongoDB User ID). This allows the webhook payload to seamlessly find the original user triggering the session so your Backend can correctly update `user.stripeCustomerId`.
