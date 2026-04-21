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

## DL-004 — Redis provider: Managed Redis over self-hosted

**Date:** 2026-03-23
**Decision:** Managed Redis (e.g. Render Managed Redis)

**Options considered:**
- Self-hosted on Render — requires a separate service, uses Render free tier slot
- Managed Redis — reliable, handled by cloud provider, BullMQ compatible

**Reasoning:**
Managed Redis requires zero infrastructure management and works over TLS out of the box. BullMQ requires a dedicated connection — managed services handle this fine via `ioredis`.

**What might change:** If performance or costs become an issue, we can switch providers by simply updating the `REDIS_URL`.

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

---

## DL-010 — Auth: Email-first registration with verification code

**Date:** 2026-03-27  
**Decision:** Registration starts with email only. The backend sends a one-time verification code. The user completes registration by submitting code + password.

**Reasoning:**
- Prevents account creation with typos (email must be reachable)
- Improves security by proving email ownership before enabling password login
- Fits the product onboarding flow (minimal friction up front)

---

## DL-011 — Social auth: Google ID token + TikTok OAuth code exchange

**Date:** 2026-03-27  
**Decision:** Support Google sign-in via ID token verification and TikTok sign-in via OAuth code exchange + user info lookup.

**Reasoning:**
- Google: frontend can obtain an ID token and exchange it directly with the API for a session
- TikTok: OAuth code exchange is the standard flow to obtain access token and fetch user profile

---

## DL-012 — Redis infrastructure: Generalizing for any provider

**Date:** 2026-04-02
**Decision:** Generalize the Redis client to support any Redis provider via standard URL and TLS configurations.

**Reasoning:**
Relying solely on Upstash or any specific provider introduces vendor lock-in. By using a standard `ioredis` configuration that supports generic `REDIS_URL` and `REDIS_TLS` toggles, the backend can easily switch between Render Managed Redis, Upstash, or a self-hosted instance without code changes.

---

## DL-013 — Observability: Prometheus Remote Write to Grafana Cloud

**Date:** 2026-04-03
**Decision:** Implement Prometheus Remote Write to export metrics directly to Grafana Cloud.

**Reasoning:**
Render services can be restarted or moved, which would lead to loss of local Prometheus metrics if only the `/metrics` endpoint is used. Remote Write ensures that metrics are pushed to a persistent cloud store (Grafana Cloud) in real-time, providing reliable long-term observability and dashboarding.

---

## DL-014 — Documentation: Modular OpenAPI 3.0 Structure

**Date:** 2026-04-01
**Decision:** Move from monolithic Swagger descriptions to a modular directory-based structure.

**Reasoning:**
As the API grows (Auth, Profile, Products, Ingestion), a single `swagger.yaml` becomes unreadable and prone to merge conflicts. Splitting definitions into per-module files (`auth.yaml`, `products.yaml`) makes the documentation easier to maintain and review.

---

## DL-015 — Architecture: Abstracting Product Enrichment Layer

**Date:** 2026-04-10
**Decision:** Abstract the product enrichment layer to support multiple e-commerce data providers.

**Reasoning:**
Currently, all product enrichment (pricing, high-quality images) relies solely on the Rainforest API (Amazon). To provide a broader and more accurate view of a product's dropshipping viability, the backend needs to pull details from a diverse set of service providers (e.g. AliExpress, CJ Dropshipping, localized suppliers). By abstracting the enrichment layer, we can aggregate data from multiple parallel providers and fall back gracefully if one fails.

**What might change:** The `ProductEnricher` will be refactored into a strategy pattern allowing dynamic provider execution.

---

## DL-016 — Ingestion: Exploring Alternate TikTok Data Providers

**Date:** 2026-04-10
**Decision:** Begin exploration of alternative TikTok data providers to supplement/backup EnsembleData.

**Reasoning:**
After shifting to an EnsembleData-only architecture to remove reliance on fragile undocumented Creative Center scraping, EnsembleData has become a single point of failure for our primary data feed. Exploring secondary TikTok data providers ensures we can implement the Orchestrator Fallback pattern originally designed for the platform, drastically reducing the risk of a full ingestion outage if EnsembleData changes its API or pricing.

## DL-017 — Ingestion: 3-Level TikTok Shop Taxonomy Migration

**Date:** 2026-04-11  
**Decision:** Migrate from a flat 10-category list to a canonical 3-level TikTok Shop category taxonomy (Primary/Sub/Leaf).

**Reasoning:**
The previous flat category list was too generic (e.g. "Beauty & Healthcare") and didn't align with how professional dropshippers research niches. By adopting the official 3-level TikTok Shop hierarchy (e.g. \`Beauty & Personal Care / Skincare / Skin Care Kits\`), we provide users with high-fidelity niche data that maps directly to current market trends.

---

## DL-018 — Data Integrity: Strict Grounding of "Units Sold" Metric

**Date:** 2026-04-11  
**Decision:** Reject all AI-estimated unit counts and strictly ground the "Units Sold" metric in verified platform-reported data (Amazon/AliExpress/Walmart).

**Reasoning:**
AI-hallucinated sales figures undermined platform trust. To restore data integrity, the `unitsSold` field now defaults to 0 and is only populated if our grounding engines (Rainforest API or Web Search) find a specific, verifiable sales string (e.g., "10K+ bought in past month"). Each verified count is accompanied by a `verified: true` link directly to the source proof.

---

## DL-019 — Ingestion: EchoTik as Primary Product Source

**Date:** 2026-04-21
**Decision:** Replace the EnsembleData hashtag pipeline as the primary product ingestion source with EchoTik (TikTok Shop structured data API).

**Options considered:**
- EnsembleData hashtag pipeline — scrapes TikTok posts, requires AI extraction (Gemini/DeepSeek) to identify products. High AI cost, unstructured data.
- EchoTik — direct TikTok Shop API with structured product data: real prices, verified sales, ratings, commission rates, image galleries. No AI extraction needed.

**Reasoning:**
EchoTik provides ground-truth TikTok Shop data — real 30-day sales counts, verified buyer reviews, actual commission rates, and structured category taxonomy. This eliminates the AI extraction cost (~$0.10–$3 per post) and removes the hallucination risk entirely. Data quality is significantly higher. The EnsembleData client is retained but used only for creator enrichment (finding real TikTok creators promoting each product).

**What might change:** EchoTik has API quotas. If quota becomes a constraint, the EnsembleData hashtag pipeline can be reactivated as a supplemental source.

---

## DL-020 — Images: Serve-Time URL Resolution for EchoTik

**Date:** 2026-04-21
**Decision:** Store original volces.com image URLs in MongoDB and resolve them to temp URLs at serve time via Redis cache, rather than exchanging URLs at ingestion time.

**Options considered:**
- Exchange at ingest time — store temp URLs in DB. Problem: temp URLs expire after 24h, staling all stored images daily.
- Exchange at serve time — store originals in DB, resolve on demand via Redis cache (20h TTL).

**Reasoning:**
Storing temp URLs in MongoDB creates a time bomb — every product image becomes invalid within 24 hours. The serve-time approach means originals are stored indefinitely and temp URLs are obtained on demand and cached in Redis for 20 hours. Cache misses trigger a single batch API call to EchoTik's `/batch/cover/download`. This also allows a pre-warm script to front-load the cache on deployment.

---

## DL-021 — Reviews: SearchApi over SerpApi

**Date:** 2026-04-21
**Decision:** Replace SerpApi with SearchApi (searchapi.io) for Google Shopping review and product detail fetching.

**Reasoning:**
SearchApi provides the same Google Shopping and Google Product engines at competitive pricing, with a cleaner three-step flow: `google_shopping` → `product_token` → `google_product` → reviews + related products. All SerpApi references (service, env vars, imports) have been removed from the codebase.

**Env var change:** `SERPAPI_KEY` → `SEARCHAPI_KEY`

---

## DL-022 — Creator Enrichment: EnsembleData Keyword Search

**Date:** 2026-04-21
**Decision:** After ingesting each EchoTik product, search EnsembleData for TikTok posts mentioning the product name and use the top creator as `primaryCreator`.

**Reasoning:**
EchoTik products have a seller (shop owner) as their creator, not a real TikTok content creator. Using EnsembleData's `keyword/full-search` endpoint lets us find the actual TikTok creator with the most views promoting that product — giving users meaningful creator intelligence (handle, followers, bio, post URL) and real engagement metrics. Non-blocking: seller record is kept as fallback if no creator post is found.
