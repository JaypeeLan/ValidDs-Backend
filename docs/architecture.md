# ValidDs Backend — Architecture

## Overview

ValidDs backend is an Express + TypeScript API server that powers authentication and profile features, stores user data in MongoDB, and serves it through a REST API to the ValidDs frontend.

The system is designed for V1 speed of delivery while remaining structurally clean enough to scale through the full 5–6 month build.

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
│  Routes: /api/v1/auth  /profile  /products                    │
│          /health  /ready  /metrics                            │
└───────┬───────────────────────┬───────────────────────────────┘
        │                       │
┌───────▼──────┐     ┌──────────▼─────────────────────────────┐
│  Redis       │     │  MongoDB Atlas                          │
│              │     │                                         │
│              │     │  Collections:                           │
│  - Cache     │     │  users  products  ingestion_logs        │
│  - Rate      │     │                                         │
│    limiting  │     └──────────────────────────────────────────┘
└──────────────┘
        │
┌───────▼────────────────────────────────────────────────────────┐
│                   Data Ingestion Pipeline                      │
│                                                                │
│  TikTok Creative Center (RapidAPI)  →  Orchestrator           │
│    ├─ Top ads (/api/trending/ads)                            │
│    ├─ Trending videos (/api/trending/video)                  │
│    ├─ Trending hashtags (/api/trending/hashtag)              │
│    └─ Keyword trends (/api/trending/keyword)                 │
│                                                                │
│  Product Extraction (Multi-Provider AI with Fallback):       │
│    1. DeepSeek API (primary, lowest cost)                    │

│    3. OpenAI GPT-4o-mini (fallback)                          │
│                                                                │
│  Freshness Tracking  →  MongoDB  →  Cache invalidation       │
└────────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│                   Observability                              │
│                                                             │
│  Sentry         — error tracking                            │
│  Prometheus     — metrics collector and Remote Write exporter│
│  Grafana Cloud  — persistent metrics, dashboards, alerting  │
│  Custom logger  — structured JSON logs (stdout → Render)    │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer Responsibilities

### API Layer (`src/api/`)
Handles HTTP only. Controllers parse requests, call services, and format responses. They never touch the database directly.

### Service Layer (`src/services/`)
All business logic lives here. Services apply rules and cross-cutting logic (authentication, token issuance, email flows) before returning data to controllers.

### Model Layer (`src/models/`)
Mongoose schemas and documents. Services currently query models directly (a dedicated repository layer can be introduced later if query complexity grows).

### Cache Layer (`src/cache/`)
Redis-backed cache sitting between the service layer and the database. The implementation is generic and supports any Redis provider (e.g., Render Managed Redis, Upstash, or self-hosted). All cache keys and TTLs are centralised in `cache.keys.ts`. Cache failures are non-fatal — a miss falls through to the database.

### Freshness Layer (`src/freshness/`)
Tracks when each entity type was last successfully updated. Adds freshness metadata to API responses so the frontend can show "last updated X minutes ago". Triggers alerts if data exceeds its staleness threshold.

### Data Ingestion Pipeline (`src/ingestion/`)
Orchestrates data collection from TikTok via RapidAPI and triggers AI-powered product extraction.

**Sources:**
- **TikTok Creative Center (RapidAPI)**: Primary data source collecting trending ads, videos, hashtags, and keyword trends
  - Endpoint: `https://tiktok-creative-center-api.p.rapidapi.com/api/trending/{ads|video|hashtag|keyword}`
  - Handles nested response structures with flexible fallback parsing (`data?.data?.materials ?? data?.data?.videos ?? data?.data?.list`)
  - Requires: `RAPIDAPI_KEY` environment variable

**Product Extraction (Multi-Provider AI):**
The extraction layer uses a provider fallback chain to minimize costs while maintaining availability. If a provider's API key is missing, the system automatically falls back to the next provider.

1. **DeepSeek API** (primary, lowest cost ~$0.10/1M tokens)
   - Environment variable: `DEEPSEEK_API_KEY`
   - Model: `deepseek-chat`
   - Format: OpenAI-compatible chat completion



3. **OpenAI GPT-4o-mini** (fallback, highest cost ~$0.15/1M input tokens)
   - Environment variable: `OPENAI_API_KEY`
   - Model: `gpt-4o-mini`
   - Format: OpenAI chat completion

**Fallback Behavior:**
```
Request → Check if DEEPSEEK_API_KEY exists
        ├─ Yes → Call DeepSeek
        │       └─ Success → return extraction
        │       └─ Failure → try next provider

                └─ No  → Check if OPENAI_API_KEY exists
                        ├─ Yes → Call OpenAI
                        │       └─ Success → return extraction
                        │       └─ Failure → log error, skip post
                        └─ No  → Skip post (no AI available)
```

**Cost Optimization:**
By prioritizing DeepSeek, the system reduces extraction costs from ~$3/post (OpenAI) to ~$0.10/post (DeepSeek) while maintaining a fallback chain. At 40 posts/day, this saves ~$86/day in AI costs.

**Implementation:** `src/services/product.extractor.ts` contains the `callProvider()` method and PROVIDERS array with the fallback chain logic.

---

## API Response Format

All success responses follow a standardized format for improved frontend consistency and clarity.

**Response Structure:**
```json
{
  "success": true,
  "message": "Product retrieved",
  "statusCode": 200,
  "data": { /* endpoint-specific data */ }
}
```

**Message Types** (defined in `src/utils/response.util.ts`):
- Authentication: `REGISTRATION_STARTED`, `LOGIN_SUCCESS`, `LOGOUT_SUCCESS`
- Profile: `PROFILE_RETRIEVED`, `PROFILE_UPDATED`
- Products: `PRODUCTS_RETRIEVED`, `PRODUCT_RETRIEVED`, `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_DELETED`
- System: `HEALTH_OK`, `SUCCESS`, `CREATED`, `UPDATED`, `DELETED`

**Implementation:** Controllers use the `successResponse<T>(data, message, statusCode)` helper from `response.util.ts` to wrap all success responses. This centralizes message management and ensures consistent response structure across all endpoints.

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

See `docs/decision-log.md` for full reasoning. Summary:

| Decision | Choice | Reason |
|---|---|---|
| Runtime | TypeScript / Node.js | Team familiarity, strong ecosystem |
| Framework | Express | Simple, well-understood, minimal magic |
| Database | MongoDB (Mongoose) | Flexible schema for evolving product data |
| Cache | Redis | Fast cache, BullMQ compatible |
| Deployment | Render | Simplest free-tier deployment path |
| Error tracking | Sentry | Best-in-class free tier |
| Metrics | Prometheus + Grafana Cloud | Standard observability stack, free tier |
| Logger | Custom (no Pino) | Zero dependency, full control over output format |

---

## Security Architecture

- **Transport**: HTTPS enforced in staging/production (Render handles TLS termination)
- **Headers**: Helmet sets HSTS, CSP, X-Frame-Options, and other protective headers
- **CORS**: Explicit origin allowlist — no wildcard in production
- **Input**: MongoDB operator injection + XSS stripped on every request
- **Rate limiting**: Global 100 req/15min + strict 10 req/15min on sensitive routes
- **Authentication**: JWT (user-facing) + internal API key (service-to-service)
- **Key storage**: API keys stored as SHA-256 hashes. Raw keys never persisted.
- **Field encryption**: AES-256-GCM for sensitive fields (credentials, tokens) in MongoDB
- **Secrets**: All credentials in environment variables. Never in code or logs.

---

## Deployment Architecture (V1)

```
GitHub → push to main
       → Render auto-deploy
       → npm install + npm run build
       → node dist/server.js
       → Health check: GET /health → 200
       → Traffic routed

External services:
  MongoDB Atlas M0 (free) — US East
  Redis (free tier)       — US East
  Sentry (free)           — cloud
  Grafana Cloud (free)    — cloud
```

All external services on free tiers. No infrastructure to manage.

---

## Known Constraints (V1)

- Render free tier sleeps after 15 minutes of inactivity (~30s cold start)
- MongoDB Atlas M0 has no automated backups
- Redis free tier limits (depends on provider)
- No static outbound IP on Render free → MongoDB Atlas uses `0.0.0.0/0` allowlist
- Single-instance deployment only (no horizontal scaling on free tier)

See `docs/risks.md` for full risk register.
