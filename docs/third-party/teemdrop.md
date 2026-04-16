# TeemDrop API Setup

TeemDrop is now the primary supplier catalog used by the hashtag ingestion pipeline. The backend tries TeemDrop first for product details and only falls back to Rainforest when TeemDrop cannot find a confident match.

---

## What It Is Used For

- Creating a short-lived auth token from your app key and secret
- Paging through the TeemDrop catalog to find a product by name
- Fetching full product detail for the matched catalog item
- Filling the existing product schema with:
  - `title` from `productNameEn`
  - `description` from the cleaned HTML description
  - `primaryImageUrl` and `imageUrls` from TeemDrop media
  - `priceMin` and `priceMax` from `productMinPrice` and `productMaxPrice`
  - `price` from `productMaxPrice`

---

## Environment Variables

Add these values to `.env`:

```bash
TEEMDROP_APP_KEY=your_app_key
TEEMDROP_APP_SECRET=your_app_secret
TEEMDROP_BASE_URL=https://openapi.teemdrop.com
TEEMDROP_USER_AGENT=PostmanRuntime/7.43.0
```

`TEEMDROP_USER_AGENT` defaults to `PostmanRuntime/7.43.0` because that matched the successful live verification requests during setup.

---

## Auth Flow

TeemDrop uses a two-step flow:

1. `POST /openapi/createToken/v1` with `apiKey` and `apiSecret`
2. For signed endpoints:
   - Build `body=${JSON.stringify(body)}&path=${path}&secret=${appSecret}&timestamp=${timestamp}`
   - HMAC-SHA256 that string using the returned token
   - Base64 encode `apiKey|token|timestamp|signatureHex`
   - Send the result as `API-SIGN`

The implementation is in [src/services/teemdrop.service.ts](/Users/sonofgod/Desktop/validDs-backend/src/services/teemdrop.service.ts).

---

## Verified Endpoints

These endpoints were verified during integration on April 15, 2026:

- `POST /openapi/createToken/v1`
- `POST /openapi/product/list/v1`
- `POST /openapi/product/detail/v1`

Observed behavior:

- A plain `curl` request was blocked by Cloudflare from this machine.
- The same request succeeded when `Accept: application/json` and `User-Agent: PostmanRuntime/7.43.0` were sent.
- `product/list` returned real catalog data including `productId`, `productNameEn`, `image`, `images`, `productMinPrice`, and `productMaxPrice`.
- `product/detail` returned the richer HTML description and category metadata used by the mapper.

---

## Matching Strategy

TeemDrop does not currently expose a direct catalog keyword search in the attached materials, so the backend:

1. Creates a token
2. Pages through the first few `product/list` pages
3. Scores English and native titles against the extracted product name
4. Fetches `product/detail` only for the best confident match

If no confident match is found, Rainforest remains the fallback supplier source.
