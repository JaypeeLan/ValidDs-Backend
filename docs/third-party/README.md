# Third-Party Services — Index

This folder contains step-by-step setup guides for every external service used by the ValidDs backend.

Each guide covers:
- What the service is and why it is used
- How to create an account
- Where to get credentials or API keys
- What to put in your `.env` file
- How to verify it is working
- Free tier limits and upgrade paths

---

## Services

| Service | Purpose | Free Tier | Guide |
|---|---|---|---|
| **MongoDB Atlas** | Primary database | 512MB storage | [mongodb-atlas.md](./mongodb-atlas.md) |
| **Redis** | Cache + job queues | Depends on provider | [redis.md](./redis.md) |
| **TeemDrop** | Primary supplier catalog enrichment | Depends on plan | [teemdrop.md](./teemdrop.md) |
| **Sentry** | Error tracking | 5k errors/month | [sentry.md](./sentry.md) |
| **Prometheus + Grafana Cloud** | Metrics + dashboards | 10k series, 14-day retention | [prometheus.md](./prometheus.md) |
| **Render** | Cloud deployment | Always-on with cold starts | [render-deployment.md](./render-deployment.md) |
| **BullMQ** | Background job queues | Library (uses Redis) | [bullmq.md](./bullmq.md) |

---

## Minimum Required for Local Development

You need at minimum:

1. **MongoDB Atlas** — for the database
2. **Redis** — for caching and queues (local or hosted)

Sentry, Prometheus, and Render are optional for local development.

---

## Minimum Required for Staging Deployment

For a working deployment on Render:

1. MongoDB Atlas
2. Redis (e.g. Render Managed Redis)
3. Render (the deployment platform itself)
4. Sentry (strongly recommended — otherwise you have no visibility into errors)

---

## Environment Variable Quick Reference

| Variable | Service | Required |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas | Yes |
| `MONGODB_DB_NAME` | MongoDB Atlas | Yes |
| `REDIS_URL` | Redis | Yes |
| `TEEMDROP_APP_KEY` | TeemDrop | No |
| `TEEMDROP_APP_SECRET` | TeemDrop | No |
| `SENTRY_DSN` | Sentry | No (but recommended) |
| `SENTRY_ENVIRONMENT` | Sentry | No |
| `METRICS_ENABLED` | Prometheus | No |
| `METRICS_PORT` | Prometheus | No |

See `.env.example` in the project root for the full list.

Additional auth guide: [google-oauth.md](./google-oauth.md)
