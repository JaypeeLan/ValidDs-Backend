# Frontend — Shopify connect & push (short guide)

Base URL: **`/api/v1`** (e.g. `https://your-api.com/api/v1`). All JSON responses use the usual `{ success, message, statusCode, data }` envelope unless noted.

Send **`Authorization: Bearer <accessToken>`** on every call except the OAuth **callback** (that is a full browser navigation to your API, initiated by Shopify).

---

## 1. On “My Shopify” load — is the server ready? Is the user linked?

```http
GET /stores/shopify/status
```

- **`data.shopifyConfigured`** — if `false`, show “Shopify is not configured” (backend missing env); do not offer connect.
- **`data.connected`** — if `true`, show linked store info from **`data.connection`** (shop name, admin link, etc.). If `false`, show connect UI.

```ts
const r = await fetch(`${API}/stores/shopify/status`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { data } = await r.json();
// data.connected, data.shopifyConfigured, data.connection
```

---

## 2. User has a store — start OAuth (“Link store”)

User enters **`something.myshopify.com`** (or handle only; backend normalizes).

```http
GET /stores/shopify/install?shop=<encoded-shop-domain>
```

**Response `data`:**

| `action` | What to do |
|----------|----------------|
| **`connect`** | `window.location.href = data.authorizeUrl` — user approves on Shopify, then Shopify redirects their browser to your **backend** callback URL (not your SPA). |
| **`signup`** | Open `data.signupUrl` in a new tab (or same window) so they can create a Shopify account / store first. |

```ts
const q = new URLSearchParams({ shop: shopInput.trim() });
const r = await fetch(`${API}/stores/shopify/install?${q}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { data } = await r.json();
if (data.action === 'signup') window.open(data.signupUrl, '_blank');
else if (data.action === 'connect') window.location.href = data.authorizeUrl;
```

If the server returns **`503`** with Shopify not configured, show a support message (nothing the user can fix in the UI).

---

## 3. After OAuth — return to your app

Shopify hits **`GET /api/v1/stores/shopify/callback`** on the **backend**. The backend then **302-redirects** to your app UI:

`{FRONTEND_URL}/?shopify_status=success&shop=...`  
`{FRONTEND_URL}/?shopify_status=success&shop=...&shopify_pending=1` (Partner App URL install — user not logged in yet)  
`{FRONTEND_URL}/?shopify_status=error&code=...&message=...`

Handle these on the **SPA root** (or a dedicated route with a Vercel rewrite), not only `/stores/shopify/callback`:

1. Read `shopify_status`, `shop`, `code`, `message`, `shopify_pending` from the query string.
2. If `shopify_pending=1` and the user is logged in → **`POST /stores/shopify/claim`** with body `{ "shop": "<shop>" }`, then refresh status.
3. If `shopify_pending=1` and not logged in → prompt sign-in, then claim.
4. Show success or error toast; strip query params; call **`GET /stores/shopify/status`**.

---

## 4. Push a ValidDs product to Shopify

Only when **`data.connected === true`**.

```http
POST /stores/shopify/products
Content-Type: application/json

{ "productId": "<MongoDB ObjectId>", "status": "draft", "price": 19.99 }
```

- **`productId`** — required, 24-char hex id from your product detail / list.
- **`status`** — optional: `draft` | `active` | `archived` (default in UI is usually **`draft`**).
- **`price`** — optional positive number (variant price override).

**Success:** **`201`** — `data.product` includes **`adminUrl`** (open in new tab so the merchant can review the product in Shopify admin).

```ts
const r = await fetch(`${API}/stores/shopify/products`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    productId,
    status: 'draft',
    ...(price != null ? { price } : {}),
  }),
});
const body = await r.json();
if (r.ok && body.data?.product?.adminUrl) window.open(body.data.product.adminUrl, '_blank');
```

Handle **`404`** (unknown product id) and **`4xx`** from Shopify validation (message in envelope).

---

## 5. Disconnect (optional)

```http
POST /stores/shopify/disconnect
```

No body. Clears the token in ValidDs only — tell the user they may also **uninstall the app** in Shopify Admin for full revocation.

```ts
await fetch(`${API}/stores/shopify/disconnect`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
```

---

## Quick checklist

| Step | Endpoint | Auth |
|------|----------|------|
| Boot / tab open | `GET /stores/shopify/status` | JWT |
| Link store | `GET /stores/shopify/install?shop=…` | JWT |
| OAuth finish | *(browser lands on backend callback → redirect to SPA)* | — |
| SPA callback page | *(parse query, then)* `GET /stores/shopify/status` | JWT |
| Push product | `POST /stores/shopify/products` | JWT |
| Unlink | `POST /stores/shopify/disconnect` | JWT |

More detail: **`docs/third-party/shopify-oauth.md`**, OpenAPI: **`src/docs/openapi/paths/stores.yaml`**.
