# Shopify OAuth — Setup Guide

For **frontend engineers** (fetch flows, redirects, push product): see **[frontend-shopify-integration.md](../frontend-shopify-integration.md)**.

## What It Is

Shopify OAuth lets a ValidDs user connect their Shopify store so we can push winning products straight from ValidDs into their catalog.

The flow works like this:

1. The user enters their `<name>.myshopify.com` domain in the "My Shopify" tab
2. Frontend calls `GET /api/v1/stores/shopify/install?shop=<shop>` → backend returns an authorize URL
3. Frontend redirects the browser to Shopify's consent screen
4. User approves the requested scopes — Shopify redirects back to `GET /api/v1/stores/shopify/callback`
5. Backend verifies the HMAC + state, exchanges the code for a permanent **Admin API access token**
6. Backend encrypts the access token (AES-256-GCM) and stores it on the user document
7. Backend redirects the browser to `${FRONTEND_URL}/stores/shopify/callback?status=success&shop=...`
8. From now on, `POST /api/v1/stores/shopify/products` can push ValidDs products to the user's store

> Shopify accounts can only be created by the user on shopify.com — the backend cannot create stores on a user's behalf. If a user has no store yet, the `/install` endpoint instead returns a Shopify signup URL.

---

## REST API reference (ValidDs backend)

All paths below are prefixed with **`/api/v1/stores`**. Source: `src/api/stores/store.routes.ts`, `src/api/stores/store.controller.ts`.

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/shopify/install` | JWT | `?shop=` → OAuth `authorizeUrl` + `state`; no `shop` → `signupUrl` for users without a store. |
| `GET` | `/shopify/callback` | None | Shopify OAuth return; validates `code`, `hmac`, `shop`, `state`; redirects to `{FRONTEND_URL}/stores/shopify/callback?…`. |
| `GET` | `/shopify/status` | JWT | `connected`, `shopifyConfigured`, public `connection` object. |
| `POST` | `/shopify/disconnect` | JWT | Clears stored connection (token) on the user. |
| `POST` | `/shopify/products` | JWT | Body `{ productId, price?, status? }` — creates a product in the merchant’s store via Admin REST `products.json`. |

**Full URLs (examples)** — replace host with your API base:

- `GET https://<api-host>/api/v1/stores/shopify/install?shop=my-store.myshopify.com`
- `GET https://<api-host>/api/v1/stores/shopify/callback` (query string from Shopify)
- `GET https://<api-host>/api/v1/stores/shopify/status`
- `POST https://<api-host>/api/v1/stores/shopify/disconnect`
- `POST https://<api-host>/api/v1/stores/shopify/products`

Canonical catalog of all V1 routes (including these) lives in **`docs/endpoints.md`**. Admin-only routes are documented separately in **`admin-docs/endpoints.md`**.

**OpenAPI (Swagger)** — the same five routes are described under tag **Stores** in `src/docs/openapi/index.yaml` (path specs in `src/docs/openapi/paths/stores.yaml`, shared schemas in `src/docs/openapi/components/schemas/Shopify.yaml`).

**Shopify Admin API (outbound)** — after OAuth, the server calls Shopify directly, e.g. `https://{shop}/admin/oauth/access_token` (token exchange), `https://{shop}/admin/api/{SHOPIFY_API_VERSION}/shop.json` (shop info), and `…/products.json` (product create). No Shopify npm SDK; see `src/services/shopify.service.ts`.

---

## Step 1: Create a Shopify Partner Account

A "Partner" account is what gives you the ability to create apps that other Shopify stores can install. It is free.

1. Go to [https://partners.shopify.com](https://partners.shopify.com)
2. Click **Join now** (or **Log in** if you already have an account)
3. Fill in your business details
4. Confirm your email

> A regular Shopify merchant account (`shopify.com`) is **not** the same as a Partner account (`partners.shopify.com`). You need the Partner account to create the app.

---

## Step 2: Create the App

1. In the Partner Dashboard, go to **Apps** in the left sidebar
2. Click **Create app**
3. Choose **Create app manually** (the "with Shopify CLI" option is not needed for this integration)
4. Fill in:
   - **App name**: `ValidDs`
   - **App URL**: your backend URL, e.g.
     - Local dev: `http://localhost:3000`
     - Staging: `https://validds-backend.onrender.com`
     - Production: `https://api.validds.com`
5. Click **Create app**

You'll land on the app's overview page.

---

## Step 3: Grab the Client ID and Client Secret

1. From the left sidebar inside your app, click **Configuration** (sometimes labelled **Client credentials** depending on the dashboard version)
2. You'll see two values at the top:
   - **Client ID** — this is your `SHOPIFY_API_KEY`
   - **Client secret** — this is your `SHOPIFY_API_SECRET` (click **Reveal** / the eye icon to view it)
3. Copy both — you'll paste them into `.env` in step 5

> If the dashboard layout has changed and you see only an "App credentials" section under **Settings** instead, look there. The values are the same; only the menu name differs across dashboard versions.

> Treat the **Client secret** like a database password. Never commit it to git. Never put it in the frontend. Never log it. If it ever leaks, rotate it from the same page.

---

## Step 4: Configure Allowed Redirection URLs

Still on the same **Configuration** page (scroll down to **URLs** / **App URL** section):

1. **App URL** — should already be set from Step 2; update if your host changed.
2. **Allowed redirection URL(s)** — add every backend host you will use, all pointing at `/api/v1/stores/shopify/callback`:
   - Local dev: `http://localhost:3000/api/v1/stores/shopify/callback`
   - Staging: `https://validds-backend.onrender.com/api/v1/stores/shopify/callback`
   - Production: `https://api.validds.com/api/v1/stores/shopify/callback`
3. Click **Save**

> The URL you put in your backend's `SHOPIFY_REDIRECT_URI` must **exactly** match one of the entries here (scheme, host, port, path) or Shopify will reject the OAuth flow with `redirect_uri is not whitelisted`.

---

## Step 5: Confirm the Scopes

ValidDs only needs to read and write the product catalog. The default scopes set in the backend are:

```
write_products,read_products
```

These do **not** give us access to customers, orders, payouts, or any PII. Users can verify this on Shopify's consent screen before approving.

No action is required in the Partner dashboard — scopes are sent dynamically in the OAuth request. The value lives in your backend env as `SHOPIFY_API_SCOPES`.

---

## Step 6: Set Your Environment Variables

Add these to your `.env` file (see `.env.example` for the canonical list):

```env
SHOPIFY_API_KEY=your-client-id-from-step-3
SHOPIFY_API_SECRET=your-client-secret-from-step-3
SHOPIFY_API_SCOPES=write_products,read_products
SHOPIFY_API_VERSION=2024-10
SHOPIFY_REDIRECT_URI=http://localhost:3000/api/v1/stores/shopify/callback
# Where to send users who don't have a Shopify account yet
SHOPIFY_SIGNUP_URL=https://www.shopify.com/signup
# Optional — Shopify Partner referral code, appended to signup URL for attribution
SHOPIFY_PARTNER_REFERRAL_CODE=
```

For staging on Render, update `SHOPIFY_REDIRECT_URI` to your Render URL and add the same URL to the Partner dashboard too (Step 4).

Restart the backend after editing `.env` so `src/config/env.validation.ts` picks up the new values.

---

## Step 7: Create a Development Store (for testing)

You don't need a real paid Shopify store to test the integration — Partners can create unlimited free **development stores**.

1. In the Partner Dashboard, go to **Stores** → **Add store**
2. Choose **Development store**
3. Pick a store name (this becomes `<name>.myshopify.com`) and set a password
4. Click **Save**

The new store will be listed under **Stores** with a "Development store" badge. Click **Log in** to enter the merchant admin.

---

## Step 8: Test the Flow

Start the dev server:

```bash
npm run dev
```

Then either use your product frontend (My Shopify / connect / push flows) or hit the endpoints manually.

### Option A — via your frontend

Wire the UI to the endpoints in **REST API reference** above (install → browser redirect to `authorizeUrl`, callback page on `FRONTEND_URL`, status, push, disconnect).

### Option B — manual curl

```bash
# 1. Get the authorize URL (must include a valid ValidDs JWT)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/stores/shopify/install?shop=validds-test.myshopify.com"

# 2. Open the returned data.authorizeUrl in a browser, approve, and Shopify
#    will redirect back to your backend automatically.

# 3. Check status
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/stores/shopify/status

# 4. Push a product (use any Product._id from your DB)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"productId":"<ObjectId>","status":"draft"}' \
  http://localhost:3000/api/v1/stores/shopify/products
```

---

## Frontend Integration

The frontend should:

1. **Connect button** that calls `GET /api/v1/stores/shopify/install?shop=<userInput>` (auth required).
   - If response has `action: 'connect'` → `window.location.href = data.authorizeUrl`
   - If response has `action: 'signup'` → open `data.signupUrl` in a new tab
2. **Callback page** at `/stores/shopify/callback` that:
   - Reads `?status=success|error&shop=&code=&message=` from the URL
   - Surfaces a success or error toast
   - Strips the params via `history.replaceState`
   - Refreshes the connection status
3. **Status badge** that calls `GET /api/v1/stores/shopify/status` to know whether to show "Connect" or "Connected".
4. **Push button** on each product detail page that calls `POST /api/v1/stores/shopify/products` with `{ productId, status?, price? }`. After success, link to the returned `adminUrl`.
5. **Disconnect button** that calls `POST /api/v1/stores/shopify/disconnect`.

See **`docs/endpoints.md`** § Shopify for full request/response detail.

---

## Security Notes

- **Never log or expose** the `SHOPIFY_API_SECRET`. It is used to:
  - Verify Shopify's HMAC on the OAuth callback (CSRF protection)
  - Sign requests to the OAuth token endpoint
- **Always use HTTPS** for the redirect URI in staging and production. Shopify will reject `http://` redirect URLs for any non-localhost host.
- The `state` parameter is a short-lived signed JWT containing `{ userId, shop, nonce, purpose: 'shopify_oauth' }`. It is verified on the callback to prevent CSRF and to recover the user identity without extra storage.
- **Access tokens are encrypted at rest** with AES-256-GCM using `ENCRYPTION_KEY`. The stored fields are `accessTokenCiphertext`, `accessTokenIv`, `accessTokenAuthTag` — never the plaintext token.
- The `shopifyConnection` subdocument is marked `select: false` on the User model and stripped from every `toJSON()` output. It is **never** sent back over the API.
- `POST /stores/shopify/disconnect` removes the token from ValidDs only. For full revocation, the user must also uninstall the app from their Shopify admin → **Settings** → **Apps and sales channels**.

---

## Going to Production

When you're ready to expose the integration to real merchants outside your dev stores:

1. In the Partner Dashboard, open your app's **Distribution** tab.
2. Choose **Public distribution** (anyone can install via a Shopify install link) or **Custom distribution** (only a fixed list of stores).
3. For **Public**, you'll be guided through Shopify's app review process — they check that your scopes match your actual usage, your privacy policy is published, and HTTPS is enforced.
4. Submit for review. Review usually takes 5–10 business days.

If you only need ValidDs users to connect their own stores (i.e. the typical SaaS use case), **Custom distribution** is faster and avoids review entirely.

---

## Troubleshooting

**`redirect_uri is not whitelisted`**
The URL in `SHOPIFY_REDIRECT_URI` is not listed under **Allowed redirection URL(s)** on the app Configuration page.
Solution: Copy the exact URL from `.env` into the Partner Dashboard and click **Save**. Match scheme, host, port, and path exactly.

**`Invalid HMAC on Shopify callback` (`SHOPIFY_INVALID_HMAC`)**
The callback was hit with a tampered or stale query string, OR `SHOPIFY_API_SECRET` in `.env` does not match the value in the Partner Dashboard.
Solution: Re-copy the Client secret from the Partner Dashboard and restart the backend.

**`Shop mismatch in OAuth callback` (`SHOPIFY_SHOP_MISMATCH`)**
The `shop` query param doesn't match the one we encoded in the `state` JWT. Usually caused by manually editing the callback URL or the OAuth flow being interrupted across two browser tabs.
Solution: Start the connect flow again from the "My Shopify" tab.

**`OAuth state expired — please try again` (`SHOPIFY_INVALID_STATE`)**
The user took longer than `JWT_EXPIRES_IN` (default 7 days) between starting the flow and approving on Shopify, or the JWT secret rotated mid-flow.
Solution: Hit the connect button again.

**`Shopify integration is not configured on this server` (`SHOPIFY_NOT_CONFIGURED`)**
One of `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, or `SHOPIFY_REDIRECT_URI` is missing from the backend env.
Solution: Re-check `.env` against Step 6 and restart the backend.

**`Shopify rejected our access token. Please reconnect your store.` (`SHOPIFY_AUTH_REVOKED`)**
The merchant uninstalled the app from their Shopify admin, OR Shopify rotated the token. The encrypted token we have no longer works.
Solution: Have the user click **Disconnect** on the My Shopify page, then connect again.

**`Shopify Admin API error (422)`**
A product push hit a Shopify validation error — typically a missing image URL, invalid variant price, or duplicate handle.
Solution: The server returns Shopify's exact error body in `details`. Inspect that JSON to see which field failed.

---

## Useful Links

- Shopify Partner Dashboard — [https://partners.shopify.com](https://partners.shopify.com)
- OAuth docs — [https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant)
- Admin REST API reference — [https://shopify.dev/docs/api/admin-rest](https://shopify.dev/docs/api/admin-rest)
- Scope reference — [https://shopify.dev/docs/api/usage/access-scopes](https://shopify.dev/docs/api/usage/access-scopes)
