# Data Ingestion Architecture

This document reflects the **current** backend. Automated bulk ingestion is largely **disabled** until sources are wired back into `IngestionOrchestrator` (`src/ingestion/orchestrator.ts`).

---

## Overview

| Area | Status | Notes |
|------|--------|--------|
| **Ingestion orchestrator** | Disabled | `IngestionOrchestrator.run()` returns no posts; logs *Ingestion cycle is disabled*. |
| **Product ingestion job** | Disabled | `src/jobs/index.ts` — no daily product pull. |
| **Creative ingestion** | Disabled | `CreativeService` — external creative fetch paths are disabled. |
| **Product enrichment** | Active (when invoked) | `ProductEnricher.mergeAndUpsert()` — AI extraction + TeemDrop supplier match + creatives + discovery (`src/services/product.enricher.ts`). |
| **Stale cleanup** | Scheduled | Still runs on its timer when jobs are enabled. |

Manual job endpoints (`POST /api/v1/jobs/product-ingestion`, `creative-ingestion`, etc.) exist but trigger the same disabled or minimal code paths unless you extend the orchestrator and services.

---

## Enrichment path (`ProductEnricher`)

When a normalized TikTok post + AI extraction are available:

1. **TeemDrop** (optional) — catalog match for supplier-style pricing when keys are configured.
2. **Media** — grounded images from extraction and post thumbnail; `ImageService` no longer calls third-party image search APIs.
3. **Sales / ratings** — AI-grounded evidence and TikTok-derived fallbacks (`product.enricher.ts`).
4. **Creatives** — `CreativeService.fetchAndIngestCreatives()` when enabled.
5. **Discovery** — `DiscoveryService.categorizeProduct()` for section tags.

Persistence: `ProductRepository.upsertEnrichedProduct()` keyed by **`externalId` + `source`**.

---

## Creative ingestion (when re-enabled)

`CreativeService` is intended to attach TikTok videos to products when external creative fetch is re-enabled. Scheduled runs are controlled in `src/jobs/index.ts`.

---

## Database upsert

| Method | Key | Used by |
|--------|-----|---------|
| `upsertEnrichedProduct()` | `externalId` + `source` | Product enricher / ingestion pipelines |

---

## Job schedule summary

Schedules in `src/jobs/index.ts` are **Africa/Lagos**-oriented. With ingestion disabled, timers may still register but product/creative runs exit early. See `GET /api/v1/jobs/status` for live state.

Manual triggers (require `X-API-Key` with `INTERNAL_API_KEY`):

- `POST /api/v1/jobs/product-ingestion`
- `POST /api/v1/jobs/creative-ingestion`
- `POST /api/v1/jobs/product-refresh`
- `POST /api/v1/jobs/stale-cleanup`

---

## Environment variables (relevant)

```bash
# TeemDrop — supplier catalog (optional)
TEEMDROP_APP_KEY=your_key
TEEMDROP_APP_SECRET=your_secret
TEEMDROP_BASE_URL=https://openapi.teemdrop.com

# AI extraction
DEEPSEEK_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_AI_API_KEY=...
```

---

## Troubleshooting

| Symptom | Likely cause | What to check |
|---------|----------------|----------------|
| No new products | Orchestrator / jobs disabled | `src/ingestion/orchestrator.ts`, `src/jobs/index.ts`, logs on manual `POST /jobs/product-ingestion` |
| Creatives empty | Creative ingestion disabled | `CreativeService` logs; job trigger response |
| `shopifyConfigured` false | Missing Shopify env | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_REDIRECT_URI` |

For architecture and API contracts, see `docs/architecture.md` and `src/docs/openapi/`.
