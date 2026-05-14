# ValidDs — Admin API (`/api/v1/admin`)

Admin-only REST routes. All endpoints below require **JWT** with **admin** role.

Responses use the standard envelope in [`docs/api-responses.md`](../docs/api-responses.md). Base URL path for all endpoints is `/api/v1`.

**OpenAPI (Swagger UI):** open **`/admin-docs`** on the API host (e.g. `http://localhost:3000/admin-docs`) for the interactive spec.

---

## `GET /admin/health`

Returns system status metrics (memory, CPU, mongo, redis, jobs).

---

## `GET /admin/analytics/users`

Returns user analytics (total users, new users today, by plan, by status).

---

## `GET /admin/analytics/products`

Returns product analytics (totals, fresh products, top categories, by source).

---

## `GET /admin/analytics/creatives`

Returns TikTok creative analytics: total creative documents, total video slots (primary plus related videos), creatives ingested in the last 24h, counts by feed `section`, ads vs organic (`isAd`), and top 10 `categoryL1` buckets.

---

## `GET /admin/users`

Returns paginated user records for dashboard management.

---

## `DELETE /admin/users/:userId`

Soft-deletes a user account.

---

## `GET /admin/transactions`

Returns paginated transaction records.

---

## `POST /admin/transactions`

Stores a transaction record.

**Body:** `{ "userId": "...", "amount": 49, "currency": "USD", "status": "paid", "mode": "test", "provider": "stripe" }`

---

## `GET /admin/waitlist`

Paginated list of waitlist signups (newest first) plus summary stats.

**Query params:** `page` (default 1), `limit` (default 50, max 200), `q` (substring match on email), `source` (exact match), `from` / `to` (ISO-8601 `createdAt` bounds).

**Response shape:** `{ entries: [...], pagination: { page, limit, total, totalPages }, stats: { total, last7Days, last24Hours } }`
