# ValidDs Backend — Architecture

## Overview

ValidDs backend is an Express + TypeScript API server for TikTok-oriented product research. It exposes REST APIs for products, creatives, auth, billing, Shopify store connection, and admin tools. Data lives in **MongoDB**; **Redis** backs caching and freshness markers. Automated bulk ingestion is **minimal / disabled** until sources are reconnected in `src/ingestion/orchestrator.ts` (see `docs/data-ingestion.md`).

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
│          /stores  /ingestion  /jobs  /admin  /billing  /health │
└───────┬───────────────────────┬───────────────────────────────┘
        │                       │
┌───────▼──────┐     ┌──────────▼──────────────────────────────┐
│  Redis       │     │  MongoDB Atlas                           │
│              │     │                                          │
│  - API cache │     │  Collections:                            │
│  - Freshness │     │  products  creatives  users              │
│                │     │  transactions                            │
└──────────────┘     └─────────────────────────────────────────┘
        │
┌───────▼────────────────────────────────────────────────────────┐
│                   Data ingestion & enrichment                  │
│                                                                │
│  IngestionOrchestrator — primary hook for future TikTok feeds │
│  ProductEnricher — AI extraction + TeemDrop + creatives path │
│  CreativeService — TikTok creatives (disabled until enabled)   │
│  ShopifyService — OAuth + Admin API product push             │
│  FreshnessService — Redis markers for last successful runs    │
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
Handles HTTP only. Controllers parse requests, call services, and format responses. They do not query MongoDB directly except through services/repositories.

### Service Layer (`src/services/`)
Business logic: `ProductService`, `CreativeService`, `DiscoveryService`, `ShopifyService`, `ProductEnricher`, AI extractors, TeemDrop client, etc.

### Model Layer (`src/models/`)
Mongoose schemas. Database access goes through `src/db/repositories/`.

### Cache Layer (`src/cache/`)
Redis-backed cache for API responses and freshness keys (`ingestion:last-run:<entity>`). Cache misses fall through to MongoDB or external calls.

### Freshness Layer (`src/freshness/`)
Tracks when entity types were last successfully updated (Redis).

### Data ingestion (`src/ingestion/`)
Shared types (`ingestion.types.ts`) and `IngestionOrchestrator`. Extend here when wiring new TikTok or catalog sources.

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
        → Response
```

---

## Key Technical Decisions

See `docs/decision-log.md` for historical reasoning. Current summary:

| Decision | Choice | Reason |
|---|---|---|
| Runtime | TypeScript / Node.js | Team familiarity, strong ecosystem |
| Framework | Express | Simple, well-understood, minimal magic |
| Database | MongoDB (Mongoose) | Flexible schema for evolving product data |
| Cache | Redis | Fast cache + freshness markers |
| Ingestion | Orchestrator placeholder | Central place to plug TikTok/catalog sources back in |
| Enrichment | `ProductEnricher` | AI + optional TeemDrop + discovery when posts exist |
| Shopify | Custom OAuth app | Store connection and product push via Admin API |
| Deployment | Render | Simplest free-tier deployment path |
| Error tracking | Sentry | Best-in-class free tier |

---

## Security Architecture

- **Transport**: HTTPS enforced in staging/production (Render handles TLS termination)
- **Headers**: Helmet sets HSTS, CSP, X-Frame-Options, and other protective headers
- **CORS**: Explicit origin allowlist — no wildcard in production
- **Input**: MongoDB operator injection + XSS stripped on every request
- **Rate limiting**: Global 100 req/15min + stricter limits on sensitive routes
- **Authentication**: JWT (user-facing) + internal API key (service-to-service)
- **Key storage**: API keys stored as hashes where applicable. Raw secrets never logged.
- **Field encryption**: AES-256-GCM for sensitive fields (e.g. Shopify tokens on user)
- **Secrets**: Environment variables only — never in code or git

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
```

---

## Known Constraints (V1)

- Render free tier sleeps after 15 minutes of inactivity (~30s cold start)
- MongoDB Atlas M0 has no automated backups
- Bulk ingestion / creative fetch paths may be disabled — check logs and `docs/data-ingestion.md`
- Single-instance deployment only (no horizontal scaling on free tier)

See `docs/risks.md` for full risk register.
