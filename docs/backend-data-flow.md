# Backend Data Flow & Endpoint Tracing Guide

This document explains how a request travels through the ValidDs backend from entry to response, and exactly how to trace an endpoint issue step by step starting from `src/app.ts`.

---

## Request Lifecycle (app.ts → response)

Every HTTP request passes through this exact chain in order:

```
HTTP Request
    │
    ▼
[1] Sentry requestHandler         ← captures request context for error reporting (prod/staging only)
    │
    ▼
[2] Prometheus metricsMiddleware   ← records request count/duration (prod/staging only)
    │
    ▼
[3] Helmet                        ← sets security headers (CSP, HSTS, X-Frame-Options, etc.)
    │
    ▼
[4] CORS                          ← validates Origin header against CORS_ALLOWED_ORIGINS
    │
    ▼
[5] express.json()                ← parses request body (1mb limit)
    │
    ▼
[6] requestLoggerMiddleware        ← assigns requestId (UUID), starts AsyncLocalStorage context,
    │                                logs "Request received" with method/path/ip
    ▼
[7] globalLimiter (rate-limit)    ← blocks if client exceeds request quota
    │
    ▼
[8] sanitizeMiddleware            ← strips MongoDB operators ($where, $gt) and XSS from inputs
    │
    ▼
[9] Routes
    ├── /health, /ready           ← healthRouter (no auth)
    ├── /docs                     ← Swagger UI
    └── /api/v1/*                 ← apiRouter → feature routers
    │
    ▼
[10] notFoundMiddleware           ← returns 404 if no route matched
    │
    ▼
[11] Sentry errorHandler          ← forwards errors to Sentry (prod/staging only)
    │
    ▼
[12] errorMiddleware              ← formats all errors into { success: false, error: ... } JSON
```

**Files:**
- `src/app.ts` — wires up middleware and mounts routers (steps 1–12)
- `src/server.ts` — bootstraps DB, Redis, metrics, then calls `createApp()`

---

## Route Resolution

When a request hits `/api/v1/*`, Express hands it to `apiRouter`:

```
src/api/index.ts        ← apiRouter — mounts all feature routers
    │
    ├── /products       → src/api/products/product.routes.ts
    ├── /auth           → src/api/auth/auth.routes.ts
    ├── /users          → src/api/users/user.routes.ts
    ├── /conversations  → src/api/conversations/...
    └── /health         → src/api/health/health.routes.ts
```

Each feature router maps HTTP methods + paths to controller functions:

```typescript
// Example: product.routes.ts (simplified)
router.get('/',         requireAuth, getFeed);       // GET /api/v1/products — list + optional ?q= search
router.get('/categories', requireAuth, getCategories);
router.get('/:id',      requireAuth, getById);       // GET /api/v1/products/:id
```

---

## Feature Layer Stack (per endpoint)

Once a route is matched, the call flows through three layers:

```
Router (routes.ts)
    │  validates path params, applies middleware
    ▼
Controller (controller.ts)
    │  parses & validates query/body with Zod
    │  calls service method
    │  formats HTTP response
    ▼
Service (service.ts)
    │  applies business logic
    │  calls repository for DB access
    │  may call external services (AI, Rainforest, etc.)
    ▼
Repository (db/repositories/*.ts)
    │  runs MongoDB queries via Mongoose
    │  returns typed documents
    ▼
MongoDB (Product, User, Conversation collections)
```

**Example — `GET /api/v1/products`:**
```
product.routes.ts  →  product.controller.ts::getFeed()
                   →  product.service.ts::getFeed()
                   →  product.repository.ts::findFeed()
                   →  Product.find({ ... })   ← Mongoose
```

---

## How to Trace an Endpoint Issue

### Step 1 — Find the `requestId`

Every log line emitted during a request includes `rid` (request ID). This is the single most important identifier.

In your terminal/log viewer, search for the failing request's `rid`:
```bash
# Example: filter all logs for one request
grep "1be26365-c92a-468c" logs/app.log
```

You will see every log line tagged with that `rid` — from "Request received" through to "Request completed" or the error.

---

### Step 2 — Read the request log

`requestLoggerMiddleware` emits two structured log lines per request:

```json
// On arrival
{ "level": 30, "msg": "Request received", "rid": "abc-123", "route": "GET /api/v1/products", "method": "GET", "path": "/api/v1/products", "ip": "::1" }

// On completion
{ "level": 30, "msg": "Request completed", "rid": "abc-123", "statusCode": 500, "durationMs": 42 }
```

If `statusCode` is 4xx/5xx, there will be an error log between these two lines.

---

### Step 3 — Find the error log

`errorMiddleware` (`src/middleware/error.middleware.ts`) catches all errors and logs them:

```json
{
  "level": 50,
  "msg": "Unhandled error",
  "rid": "abc-123",
  "module": "error-handler",
  "type": "CastError",
  "message": "Cast to ObjectId failed...",
  "stack": "..."
}
```

The `type` and `message` fields tell you exactly what threw.

---

### Step 4 — Follow the stack trace

The `stack` field in the error log shows the exact file and line number where the error originated. Common patterns:

| Error Type | Typical Cause | File to Check |
|---|---|---|
| `CastError` | Invalid MongoDB ObjectId in a route param | controller — check param validation |
| `ValidationError` | Mongoose schema mismatch | model schema or repository update shape |
| `ZodError` | Request body/query failed validation | controller Zod schema |
| `MongoServerError / 11000` | Duplicate key on upsert | repository — check unique index field |
| `AxiosError` | External API call failed (Rainforest, EnsembleData) | service layer |
| `JsonWebTokenError` | Bad or expired JWT | `auth.middleware.ts` |

---

### Step 5 — Trace backwards through the layers

Starting from the error location in the stack trace, trace upward:

```
Error thrown in → ProductRepository.findFeed()
    ↑ called by   ProductService.getFeed()
    ↑ called by   ProductController.getFeed()
    ↑ called by   GET /api/v1/products handler
    ↑ registered in product.routes.ts
    ↑ mounted by  apiRouter (src/api/index.ts)
    ↑ mounted by  app.use('/api/v1', apiRouter) in app.ts
```

---

### Step 6 — Check middleware if the error has no stack

If the error log has no proper stack (e.g. CORS rejection, rate limit, auth failure), it was likely thrown by middleware **before** the route was reached:

| HTTP Status | Likely Middleware | File |
|---|---|---|
| `429 Too Many Requests` | `globalLimiter` | `src/middleware/rate-limit.middleware.ts` |
| `401 Unauthorized` | `authenticate` | `src/middleware/auth.middleware.ts` |
| `403 Forbidden` | CORS | `app.ts` CORS block |
| `400 Bad Request` | Zod validation in controller | `*.controller.ts` |

---

## Request ID in Practice

In development, all logs print to stdout in JSON. Every log line has `rid`. To trace a request end-to-end, pipe logs and grep:

```bash
npm run dev 2>&1 | grep "YOUR_REQUEST_ID"
```

In production on Render, use the log search in the Render dashboard and filter by the `rid` returned in the `X-Request-Id` response header — this header is set on every response by `requestLoggerMiddleware`.

---

## Adding a New Endpoint (Checklist)

Follow this file pattern to stay consistent with the existing layers:

```
src/api/<feature>/
  ├── <feature>.routes.ts       ← mount on apiRouter in src/api/index.ts
  ├── <feature>.controller.ts   ← parse request, call service, return response
  ├── <feature>.service.ts      ← business logic
  └── <feature>.validator.ts    ← Zod schemas for request validation
src/db/repositories/<feature>.repository.ts  ← MongoDB queries
src/models/<feature>.model.ts               ← Mongoose schema
```

**Key rules:**
1. Controllers never touch Mongoose directly — always go through the service
2. Services never build raw MongoDB queries — always go through the repository
3. All request input (body, query, params) must be validated with Zod in the controller before use
4. All errors propagate via `throw` — never send error responses manually; let `errorMiddleware` handle it

---

## Quick Reference: File → Responsibility

| File | Responsibility |
|---|---|
| `src/server.ts` | Boot sequence: MongoDB → Redis → metrics → jobs → HTTP |
| `src/app.ts` | Middleware order and router mounting |
| `src/api/index.ts` | Feature router registry |
| `src/middleware/request-logger.middleware.ts` | `requestId` assignment and request/response logging |
| `src/middleware/error.middleware.ts` | Global error formatter (always last middleware) |
| `src/middleware/auth.middleware.ts` | JWT validation |
| `src/middleware/rate-limit.middleware.ts` | Request throttling |
| `src/middleware/sanitize.middleware.ts` | NoSQL injection + XSS prevention |
| `src/config/env.validation.ts` | Zod schema for all env vars — crashes on startup if invalid |
| `src/jobs/index.ts` | Background job scheduler (product refresh, hashtag pipeline, stale cleanup) |
| `src/ingestion/orchestrator.ts` | Creative Center ingestion entrypoint |
| `src/ingestion/ensemble/hashtag-ingestion.pipeline.ts` | Hashtag pipeline entrypoint |
| `src/freshness/freshness.service.ts` | Tracks when data was last updated |
| `src/monitoring/metrics.ts` | Prometheus counters/gauges |
| `src/monitoring/alerts.ts` | Webhook/Sentry alert triggers |
