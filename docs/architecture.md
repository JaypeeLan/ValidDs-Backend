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
│  Routes: /api/v1/auth  /profile                               │
│          /health  /ready                                      │
└───────┬───────────────────────┬────────────────────────────────┘
        │                       │
┌───────▼──────┐     ┌──────────▼─────────────────────────────┐
│  Redis       │     │  MongoDB Atlas                          │
│  (Upstash)   │     │                                         │
│              │     │  Collections:                           │
│  - Cache     │     │  users                                  │
│  - Rate      │     │                                         │
│    limiting  │     └──────────────────────────────────────────┘
└──────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│                   Observability                              │
│                                                             │
│  Sentry         — error tracking                            │
│  Prometheus     — metrics (/metrics endpoint)               │
│  Grafana Cloud  — dashboards and alerting                   │
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
Redis-backed cache sitting between the service layer and the database. All cache keys and TTLs are centralised in `cache.keys.ts`. Cache failures are non-fatal — a miss falls through to the database.

### Freshness Layer (`src/freshness/`)
Tracks when each entity type was last successfully updated. Adds freshness metadata to API responses so the frontend can show "last updated X minutes ago". Triggers alerts if data exceeds its staleness threshold.

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
| Cache | Redis (Upstash) | Serverless, free tier, BullMQ compatible |
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
  Upstash Redis (free)    — US East
  Sentry (free)           — cloud
  Grafana Cloud (free)    — cloud
```

All external services on free tiers. No infrastructure to manage.

---

## Known Constraints (V1)

- Render free tier sleeps after 15 minutes of inactivity (~30s cold start)
- MongoDB Atlas M0 has no automated backups
- Upstash Redis free tier limited to 10,000 commands/day
- No static outbound IP on Render free → MongoDB Atlas uses `0.0.0.0/0` allowlist
- Single-instance deployment only (no horizontal scaling on free tier)

See `docs/risks.md` for full risk register.
