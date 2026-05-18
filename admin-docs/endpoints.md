# ValidDs — Admin API (`/api/v1/admin`)

Admin-only REST routes. All endpoints require **JWT** with **admin** role.

Responses use the standard envelope in [`docs/api-responses.md`](../docs/api-responses.md). Base path: `/api/v1`.

**Swagger UI:** `/admin-docs` on the API host (e.g. `http://localhost:3000/admin-docs`).

---

## Multi-market content

Products and creatives live in **per-market MongoDB collections** (`products_us`, `creatives_uk`, …). Supported markets:

`US`, `CA`, `MX`, `UK`, `AU`, `NZ`, `ES`, `DE`, `FR`, `IT`

| Operation | How to pass `market` |
|-----------|----------------------|
| List / delete products or creatives | Required query: `?market=US` |
| Create product or creative | Required body field: `"market": "US"` |
| Product / creative analytics | Optional query: `?market=US` (omit to aggregate all markets) |

---

## `GET /admin/health`

System metrics: memory, CPU load, MongoDB/Redis status, and background job timer state (`GET /jobs/status` shape under `data.jobs`).

---

## `GET /admin/analytics/users`

User totals: `totalUsers`, `newUsersToday`, `usersByPlan`, `usersByStatus`.

---

## `GET /admin/analytics/products`

Product pipeline stats across one or all markets.

**Query:** `market` (optional) — e.g. `?market=UK`

**Response `data`:** `markets`, `totalProducts`, `freshProducts24h`, `productsBySource`, `topCategories`

---

## `GET /admin/analytics/creatives`

Creative / video inventory stats across one or all markets.

**Query:** `market` (optional)

**Response `data`:** `markets`, `totalCreatives`, `totalVideos`, `freshCreatives24h`, `creativesBySection`, `creativesByAdType` (`ads` / `organic`), `topCategories`

---

## `GET /admin/users`

Paginated users for the admin dashboard.

**Query:** `page`, `limit`, `status` (`active` \| `suspended` \| `deleted`), `role` (`user` \| `admin`), `plan` (`free` \| `explorer` \| `pro` \| `premium`), `q` (email/name search)

**Response `data`:** `users[]` (each with `id`, `email`, `name`, `role`, `plan`, `status`, `creditBalance`, `contentRegion`, …), `pagination`

---

## `PATCH /admin/users/:userId/status`

Update account status.

**Body:** `{ "status": "active" | "suspended" }`

---

## `DELETE /admin/users/:userId`

Hard-deletes a user. Returns `400` if the admin attempts to delete their own account.

---

## `GET /admin/products`

List products in a single market collection.

**Query (required):** `market`

**Query (optional):** `page`, `limit`, `status` (`active` \| `archived` \| `stale`), `source`, `category` (matches `categoryL1`), `q` (title/description search)

**Response `data`:** `market`, `products[]`, `pagination`

---

## `POST /admin/products`

Create a product in a market collection. Server sets `status: review`, `validationStatus: pending`.

**Body (required):** `market`, `title`, `categoryL1`, `externalId`

**Body (optional):** `categoryL2`, `description`, `price`, `currency` (default `USD`), `productUrl`, `shopName`, `primaryImageUrl`, `source` (default `admin`)

**Response `data`:** `market`, `product`

---

## `DELETE /admin/products/:id`

Delete a product from a market collection.

**Query (required):** `market`

---

## `POST /admin/creatives`

Create a creative in a market collection.

**Body (required):** `market`, `externalVideoId`

**Body (optional):** `productId` (24-char hex ObjectId), `videoPlayUrl`, `thumbnailUrl`, `isAd` (default `false`), `section` (`store` \| `affiliate` \| `ads`, default `ads`), `creatorHandle`, `description`

**Response `data`:** `market`, `creative`

---

## `DELETE /admin/creatives/:id`

Delete a creative from a market collection.

**Query (required):** `market`

---

## `GET /admin/transactions`

Paginated billing transactions.

**Query:** `page`, `limit`, `status` (`pending` \| `paid` \| `failed` \| `refunded`), `mode` (`test` \| `live`)

---

## `POST /admin/transactions`

Record a transaction manually.

**Body:** `userId`, `amount` (required); optional `userEmail`, `currency`, `status`, `mode`, `provider` (default `stripe`), `reference`, `stripePaymentIntentId`, `stripeCustomerId`, `metadata`

---

## `GET /admin/waitlist`

Paginated waitlist signups (newest first) with summary stats.

**Query:** `page` (default 1), `limit` (default 50, max 200), `q` (email substring), `source`, `from` / `to` (ISO-8601 `createdAt` bounds)

**Response `data`:** `entries[]`, `pagination`, `stats` (`total`, `last7Days`, `last24Hours`)
