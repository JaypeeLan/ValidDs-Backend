# Decision Log

All significant backend technical decisions are recorded here.
Format: decision made, options considered, reasoning, and what might change later.

---

## DL-001 — Language: TypeScript over plain JavaScript

**Date:** 2026-03-23
**Decision:** Use TypeScript throughout

**Options considered:**
- Plain JavaScript — faster to start, no compilation step
- TypeScript — type safety, better IDE support, catches bugs at compile time

**Reasoning:**
ValidDs is a large project with multiple contributors expected over the contract period. TypeScript pays for itself quickly on a codebase this size through autocomplete, interface contracts between layers, and catching shape mismatches between ingestion transformers and DB schemas.

**What might change:** Nothing. TypeScript stays.

---

## DL-002 — Framework: Express over Fastify / NestJS

**Date:** 2026-03-23
**Decision:** Express

**Options considered:**
- Fastify — faster, built-in schema validation, TypeScript-first
- NestJS — opinionated, lots of structure out of the box
- Express — minimal, widely known, maximum flexibility

**Reasoning:**
NestJS would add significant boilerplate and learning curve for a V1 build. Fastify is excellent but less universally familiar. Express is understood by any Node.js engineer who joins — no onboarding friction. Performance difference is irrelevant at V1 scale.

**What might change:** Could migrate to Fastify if raw throughput becomes a bottleneck. Not expected for V1.

---

## DL-003 — Database: MongoDB over PostgreSQL

**Date:** 2026-03-23
**Decision:** MongoDB (via Mongoose + Atlas)

**Options considered:**
- PostgreSQL (Supabase or Neon free tier) — relational, strict schema, excellent querying
- MongoDB (Atlas M0) — document model, flexible schema, free tier

**Reasoning:**
TikTok product data is schema-heavy in some areas and sparse in others. Products have varying field availability depending on the data source. A document model handles this without constant migrations. Atlas M0 provides a generous free tier. The product feed + detail query patterns map cleanly to MongoDB.

**What might change:** If complex relational queries become necessary (e.g. multi-table joins for supplier–product relationships), a hybrid approach (MongoDB + Redis for cache + optional Postgres for specific analytics tables) might be considered.

---

## DL-004 — Redis provider: Upstash over self-hosted or Railway

**Date:** 2026-03-23
**Decision:** Upstash

**Options considered:**
- Self-hosted on Render — requires a separate service, uses Render free tier slot
- Railway Redis — free tier is limited, Railway can be unpredictable
- Upstash — serverless, TLS by default, BullMQ compatible, 10k commands/day free

**Reasoning:**
Upstash requires zero infrastructure management and works over HTTPS/TLS out of the box. The 10k commands/day free tier is sufficient for V1. BullMQ requires a dedicated connection — Upstash handles this fine via `ioredis`.

**What might change:** If daily command usage consistently exceeds 10k, upgrade to Upstash pay-as-you-go (~$0.20 per 100k commands).

---

## DL-005 — Deployment: Render over Railway / Fly.io / Heroku

**Date:** 2026-03-23
**Decision:** Render

**Options considered:**
- Railway — generous free tier, but unpredictable billing
- Fly.io — more powerful but more complex to configure
- Heroku — no longer has a meaningful free tier
- Render — simple, GitHub integration, health checks, free tier

**Reasoning:**
Render free tier deploys immediately from GitHub, supports health checks natively, and has clear upgrade paths. The sleep-after-inactivity behaviour on free tier is acceptable for a test deployment.

**What might change:** Upgrade to Render Starter ($7/month) when always-on is needed for a real demo or user testing.

---

## DL-006 — Logger: Custom over Pino / Winston

**Date:** 2026-03-23
**Decision:** Custom logger

**Options considered:**
- Pino — very fast, structured JSON, excellent ecosystem
- Winston — highly configurable, well-known
- Custom — zero dependencies, full control, purpose-built for this project

**Reasoning:**
Pino is excellent but adds a dependency and its configuration is non-trivial to get right in production. Winston is heavier than needed. For a project this size, a custom logger with AsyncLocalStorage context, JSON/pretty formatters, and pluggable transports is straightforward to build and gives full control — which was explicitly requested.

**What might change:** If log volume becomes very high and performance matters, revisit Pino.

---

## DL-007 — Encryption: AES-256-GCM over AES-256-CBC

**Date:** 2026-03-23
**Decision:** AES-256-GCM for field-level encryption

**Reasoning:**
GCM mode provides authenticated encryption — it both encrypts and verifies data integrity with a single operation. CBC mode requires a separate HMAC for integrity verification. GCM is the modern standard for field-level encryption. No external library needed — Node's built-in `crypto` module handles it.

---

## DL-008 — JWT: Custom HS256 over jsonwebtoken library

**Date:** 2026-03-23
**Decision:** Custom JWT implementation

**Reasoning:**
The `jsonwebtoken` npm package is 3+ years without a major update and has had historical vulnerabilities. HS256 JWTs are straightforward to implement with Node's built-in `crypto`. The custom implementation is ~60 lines, fully understood, and has no supply chain risk.

**What might change:** If asymmetric keys (RS256) become necessary (e.g. multi-service auth), switch to `jose` or `fast-jwt`.

---

## DL-009 — Ingestion: Orchestrator pattern with explicit fallbacks

**Date:** 2026-03-23
**Decision:** Separate source modules + orchestrator that manages fallback switching

**Reasoning:**
TikTok data acquisition is the highest-risk component of the system. A single source that breaks takes down the whole product. The orchestrator pattern means: primary fails → fallback A → fallback B → alert, without any manual intervention. Each source is independently testable. New sources can be added without touching the orchestrator logic.

**What might change:** Sources will be confirmed and filled in during Week 1–2 of the engagement.
