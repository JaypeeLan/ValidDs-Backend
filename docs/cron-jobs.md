# Backend scheduling (standalone deployment)

Deploy **only this repository** as the API (Render web service or VPS). Cron jobs in `render.yaml` call **this service’s public URL** — not scraper or live-scrapper.

## Three separate hosts

| Repository / service            | Scheduling                                                         |
| ------------------------------- | ------------------------------------------------------------------ |
| **validDs-backend** (this repo) | `render.yaml` crons → `POST /api/v1/jobs/*`                        |
| **scraper**                     | Worker loop + daily metric-trends cron (`docs/cron-jobs.md` there) |
| **live-scrapper**               | In-process scheduler (`docs/scheduling.md` there)                  |

Shared: `MONGODB_URI`, `MONGODB_DB_NAME`. No shared `render.yaml` across repos.

---

## API environment

```bash
ENABLE_BACKGROUND_JOBS=true
ENABLE_IN_PROCESS_SCHEDULERS=false
```

`CRON_BACKEND_URL` on cron services must be this API’s origin (e.g. `https://validds-api.onrender.com`), with the same `INTERNAL_API_KEY` as the web service.

---

## Jobs (this repo only)

| Cron (UTC)    | Lagos | Endpoint                           |
| ------------- | ----- | ---------------------------------- |
| `0 23 * * *`  | 00:00 | `POST /jobs/product-ingestion`     |
| `5 23 * * *`  | 00:05 | `POST /jobs/creative-ingestion`    |
| `0 11 * * *`  | 12:00 | `POST /jobs/creative-ingestion`    |
| `*/5 * * * *` | —     | `POST /jobs/stale-cleanup`         |
| `0 * * * *`   | —     | `POST /jobs/live-monitor-discover` |

Does **not** update `salesTrend` / `revenueTrend` — that is the **scraper** repo.

---

## Render

1. Deploy web service from **repository root** (where `package.json` lives).
2. Blueprint: `render.yaml` in this repo — env group `validds-backend-cron` with `CRON_BACKEND_URL` + `INTERNAL_API_KEY`.
3. Cron services use `node cron/trigger-job.mjs` (no monorepo path).

## GitHub Actions

Workflow: **`.github/workflows/backend-cron.yml`** in this repo (not a parent monorepo).

Secrets: `BACKEND_URL` or `CRON_BACKEND_URL`, `INTERNAL_API_KEY`.

## Manual test

```bash
CRON_BACKEND_URL=https://your-api.onrender.com \
INTERNAL_API_KEY=your_key \
node cron/trigger-job.mjs stale-cleanup
```

## Monitoring

```bash
curl -sS -H "X-API-Key: $INTERNAL_API_KEY" \
  "$CRON_BACKEND_URL/api/v1/jobs/status"
```
