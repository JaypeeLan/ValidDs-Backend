# Week 4 — documentation sync note (2026-04-17)

This Markdown file supplements **`week_4.docx`**. It lists sources that changed this week so other `project_docs/*.docx` exports can be refreshed manually if needed.

## API surface (prefer OpenAPI over `endpoints.docx`)

- **Products**: single `GET /api/v1/products` with optional `q`, `page`, `limit`, `section`, `isAd`, filters; removed `/products/all` and `/products/search`.
- **Product fields**: `isTopAd` (derived), `discoverySections` includes `top-ads` when rules match; filters use `discoverySections`, not `adSignals`.
- **Rate limits**: global and auth strict limiters **disabled** in code (temporary).

## Ingestion / data

- **SearchAPI** mapping (shopping / inline shopping).
- **EnsembleData** parsing fixes (`data` array, `aweme_info`).
- **Cleanup**: low-view filter, post-ingestion cleanup, duplicate/generic title deletion.

## Ops

- **Redis**: product feed cache revision + do not cache empty totals.
- **Jobs / admin**: analytics, health, jobs management endpoints (see OpenAPI).

## Suggested manual refresh

If you maintain Word copies of `endpoints.docx` or `data_ingestion.docx`, refresh sections that describe: product routes, auth throttling, Serp vs SearchAPI, and scheduled jobs.
