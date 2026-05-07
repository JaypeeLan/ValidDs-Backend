# ValidDs Backend — Architecture

## Overview

ValidDs backend is an Express + TypeScript API server that powers TikTok Shop product discovery. It ingests structured product data from EchoTik, enriches it with real TikTok creator data (EnsembleData) and Google Shopping reviews (SearchApi), stores results in MongoDB, and serves them via a REST API to the ValidDs frontend.

---

## System Components

```
┌────────────────────────────────────────────────────────────────┐
│                        ValidDs Frontend                        │
└───────────────────────────────┬────────────────────────────────┘
                                │ HTTPS / REST
┌───────────────────────────────▼────────────────────────────────┐
│                     Express API Server                         │
│                                                                │
│  Middleware stack:                                             │
│  Helmet → CORS → Body Parser → Request Logger →               │
│  Rate Limiter → Sanitizer → Routes → Error Handler            │
│                                                                │
│  Routes: /api/v1/auth  /profile  /products  /creatives        │
│          /admin  /billing  /jobs  /health                     │
└───────┬───────────────────────┬───────────────────────────────┘
        │                       │
┌───────▼──────┐     ┌──────────▼──────────────────────────────┐
│  Redis       │     │  MongoDB Atlas                           │
│              │     │                                          │
│  - API cache │     │  Collections:                            │
│  - Image URL │     │  products  creatives  users              │
│    resolution│     │  transactions                            │
│  - Freshness │     │                                          │
└──────────────┘     └─────────────────────────────────────────┘
        │
┌───────▼────────────────────────────────────────────────────────┐
│                   Data Ingestion Pipeline                      │
│                                                                │
│  EchoTik API (Primary — TikTok Shop structured data):         │
│    ├─ /product/list   — paginated, sorted by 30d sales        │
│    ├─ /product/comment — verified buyer reviews               │
│    └─ /batch/cover/download — image temp URL exchange         │
│                                                                │
│  EnsembleData (Creator Enrichment):                           │
│    └─ /keyword/full-search — find real TikTok creator         │
│         promoting the product → overwrites primaryCreator     │
│                                                                │
│  SearchApi (Review Enrichment):                               │
│    ├─ google_shopping → product_token                         │
│    └─ google_product  → reviews + relatedProducts             │
│                                                                │
│  CreativeService — TikTok video ingestion per product         │
│                                                                │
│  Image Resolution (serve-time, not ingest-time):             │
│    └─ echotik.image.ts → Redis cache → /batch/cover/download  │
│                                                                │
│  Freshness Tracking → MongoDB → Cache invalidation            │
└────────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│                   Observability                              │
│                                                             │
│  Sentry         — error tracking                            │
│  Custom logger  — structured JSON logs (stdout → Render)    │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer Responsibilities

### API Layer (`src/api/`)
Handles HTTP only. Controllers parse requests, call services, and format responses. They never touch the database directly. Product controllers resolve EchoTik image URLs at serve time via `toPlainWithImages()`.

### Service Layer (`src/services/`)
All business logic lives here. Key services:
- `SearchApiService` — Google Shopping review and related product fetching
- `DiscoveryService` — categorizes products into discovery sections
- `CreativeService` — fetches and ingests TikTok creative videos
- `ProductService` — product feed, search, and cleanup logic

### Model Layer (`src/models/`)
Mongoose schemas and documents. All database access goes through `src/db/repositories/`.

### Cache Layer (`src/cache/`)
Redis-backed cache. Used for:
- API response caching (generic TTL)
- EchoTik image URL resolution (`echotik:img:<url>`, 20h TTL)
- Freshness tracking (`ingestion:last-run:<entity>`)

Cache failures are non-fatal — a miss falls through to the database or external API.

### Freshness Layer (`src/freshness/`)
System-level (Redis-backed) tracking of when each entity type was last successfully ingested. Separate from document-level `status` field (`active` | `stale` | `archived`).

### Data Ingestion Pipeline (`src/ingestion/`)

**EchoTik pipeline** (`src/ingestion/echotik/`) — primary source:
- Fetches structured TikTok Shop product data
- No AI extraction required — data is already structured
- Real pricing, ratings, sales figures, image gallery, commission rates

**EnsembleData** (`src/ingestion/ensemble/`) — creator enrichment:
- Used post-ingest to resolve real TikTok creators promoting each product
- `primaryCreator` is overwritten with the creator of the highest-view post found

**SearchApi** (`src/services/search.service.ts`) — review enrichment:
- Three-step: google_shopping → product_token → google_product → reviews

---

## API Response Format

All success responses follow a standardized format:

```json
{
  "success": true,
  "message": "Product retrieved",
  "statusCode": 200,
  "data": { }
}
```

---

## Request Flow (Read Path)

```
Request → Middleware stack
        → Route → Controller
        → Service
        → Cache check (Redis)
            └── Hit  → return cached response
            └── Miss → Repository (MongoDB)
                     → Cache the result
                     → return response
        → (EchoTik products) resolve image URLs via echotik.image.ts
        → Response
```

---

## Key Technical Decisions

See `docs/decision-log.md` for full reasoning. Summary:

| Decision | Choice | Reason |
|---|---|---|
| Runtime | TypeScript / Node.js | Team familiarity, strong ecosystem |
| Framework | Express | Simple, well-understood, minimal magic |
| Database | MongoDB (Mongoose) | Flexible schema for evolving product data |
| Cache | Redis | Fast cache; also used for image URL resolution |
| Product source | EchoTik | Structured TikTok Shop data — no AI extraction cost |
| Creator data | EnsembleData | Real TikTok @handles and engagement metrics |
| Reviews | SearchApi | Google Shopping reviews + related products |
| Image serving | Serve-time resolution | volces.com URLs expire 24h; store originals, resolve at request time |
| Deployment | Render | Simplest free-tier deployment path |
| Error tracking | Sentry | Best-in-class free tier |

---

## Security Architecture

- **Transport**: HTTPS enforced in staging/production (Render handles TLS termination)
- **Headers**: Helmet sets HSTS, CSP, X-Frame-Options, and other protective headers
- **CORS**: Explicit origin allowlist — no wildcard in production
- **Input**: MongoDB operator injection + XSS stripped on every request
- **Rate limiting**: Global 100 req/15min + strict 10 req/15min on sensitive routes
- **Authentication**: JWT (user-facing) + internal API key (service-to-service)
- **Key storage**: API keys stored as SHA-256 hashes. Raw keys never persisted.
- **Field encryption**: AES-256-GCM for sensitive fields in MongoDB
- **Secrets**: All credentials in environment variables. Never in code or logs.

---

## Deployment Architecture (V1)

```
GitHub → push to staging branch
       → Render auto-deploy
       → npm install + npm run build
       → node dist/server.js
       → Health check: GET /health → 200
       → Traffic routed

External services:
  MongoDB Atlas M0 (free) — US East
  Redis (Upstash free)    — US East
  Sentry (free)           — cloud
  Grafana Cloud (free)    — cloud
```

---

## Known Constraints (V1)

- Render free tier sleeps after 15 minutes of inactivity (~30s cold start)
- MongoDB Atlas M0 has no automated backups
- EchoTik image URLs expire after 24 hours (mitigated by serve-time resolution + Redis cache)
- EchoTik API has usage quotas — contact support to increase if ingestion fails mid-run
- EnsembleData rate-limited to 1 request per 2 seconds — adds latency per product during ingestion
- Single-instance deployment only (no horizontal scaling on free tier)

See `docs/risks.md` for full risk register.
