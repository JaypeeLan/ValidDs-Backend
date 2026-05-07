# Project documentation (ValidDs Backend)

This folder holds **weekly status Word reports** and **static reference exports** (architecture, ingestion, endpoints, etc.). Those `.docx` files were last bulk-exported around **2026-04-12** and do not auto-sync with the codebase.

## Where to look for “live” truth

| Topic | Canonical location |
|--------|---------------------|
| HTTP API (paths, query params, schemas) | `src/docs/openapi/` (served at `/docs` when the app runs) |
| Environment variables | `.env.example` |
| Developer-oriented endpoint list | `docs/endpoints.md` (repo root `docs/`) |
| Data sources (reader-friendly) | `data_sources.txt` (repo root) |

## Files here

| File | Purpose |
|------|---------|
| `week_2.docx`, `week_3.docx`, `week_4.docx` | Week-by-week delivery narrative |
| `architecture.docx`, `data_ingestion.docx`, … | Point-in-time design exports — treat as **historical** unless refreshed manually |
| `schemas.docx` | **Regenerated 2026-04-18** from `product.model.ts` / `creative.model.ts` + API response notes (replaces obsolete ProductVideo / adSignals text) |

When you ship a major API or ingestion change, either **re-export** the affected Word doc from your template or add a short note under `project_docs/` in Markdown (see `WEEK4_SYNC.md`).
