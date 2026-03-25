# Prometheus + Grafana Cloud — Setup Guide

## What It Is

Prometheus collects performance metrics from the running app (request rates, response times, error counts, etc.). Grafana displays those metrics as dashboards.

ValidDs uses **Grafana Cloud free tier** which includes hosted Prometheus — meaning you do not need to run your own Prometheus server. Grafana Cloud scrapes the `/metrics` endpoint on your app and stores the data for you.

**Free tier:** 10,000 active metric series, 14-day retention — more than sufficient for V1.

---

## How It Works

```
ValidDs app                Grafana Cloud
(prom-client)    →  scrape  →  Prometheus  →  Grafana dashboards
/metrics endpoint           (hosted)
```

The app exposes a `/metrics` endpoint (on `METRICS_PORT`, default 9090). Grafana Cloud's agent periodically fetches that endpoint and ingests the data.

---

## Step 1: Create a Grafana Cloud Account

1. Go to [https://grafana.com/auth/sign-up](https://grafana.com/auth/sign-up)
2. Sign up with GitHub or email
3. Create a **stack** — this is your Grafana Cloud workspace
   - Name it something like `validds` or `supreme-ecom`
   - Choose the region closest to your deployment

---

## Step 2: Set Up Remote Write (Push from App to Grafana)

Since Render free tier does not expose multiple ports, we use **remote write** (the app pushes metrics to Grafana) instead of scraping.

### Install the Grafana Agent on your local machine (for testing)

Or use the push approach via `prom-client`'s Pushgateway — but the simplest V1 approach is:

### Option A: Grafana Cloud Agent on Render (Recommended for V1)

1. In Grafana Cloud, go to **Connections** → **Add new connection**
2. Search for **Hosted Prometheus metrics**
3. Under **Via Grafana Agent**, follow the setup instructions
4. You will get a `PROMETHEUS_REMOTE_WRITE_URL`, `PROMETHEUS_USERNAME`, and `PROMETHEUS_API_KEY`

### Option B: Use `prometheus-remote-write` library

Add to your app:

```bash
npm install @prometheus-io/pushgateway
```

Or simply expose the metrics endpoint and use Grafana Cloud's **Synthetic Monitoring** to scrape it if your service URL is public.

---

## Step 3: Environment Variables

If using remote write, add to `.env`:

```env
METRICS_ENABLED=true
METRICS_PORT=9090
PROMETHEUS_REMOTE_WRITE_URL=https://prometheus-xxx.grafana.net/api/prom/push
PROMETHEUS_USERNAME=123456
PROMETHEUS_API_KEY=glc_xxxxx
```

---

## Step 4: Access the Grafana Dashboard

1. Go to your Grafana Cloud stack URL (e.g. `https://yourorg.grafana.net`)
2. Go to **Dashboards** → **Import**
3. Import dashboard ID `1860` — this is the standard Node.js dashboard
4. Select your Prometheus data source

---

## Key Metrics to Watch

| Metric | What It Tells You |
|---|---|
| `http_requests_total` | Request volume by route and status code |
| `http_request_duration_ms` | API response time (p50, p95, p99) |
| `ingestion_jobs_total` | How often ingestion runs and whether it succeeds |
| `ingestion_records_ingested_total` | How much data is flowing |
| `cache_hits_total` / `cache_misses_total` | Redis cache efficiency |
| `data_freshness_seconds` | How stale the data is per entity |
| `nodejs_heap_used_bytes` | Memory usage |
| `process_cpu_seconds_total` | CPU usage |

---

## Free Tier Limits

| Limit | Value |
|---|---|
| Active metric series | 10,000 |
| Data retention | 14 days |
| Dashboards | Unlimited |
| Alerting rules | 10 |
| Team members | 3 |

ValidDs V1 will use well under 10,000 series.

---

## Setting Up Alerts in Grafana

1. Go to **Alerting** → **Alert Rules** → **New alert rule**
2. Useful alerts for V1:
   - `ingestion_jobs_total{status="failure"}` > 3 in 5 minutes → ingestion is broken
   - `data_freshness_seconds{entity="product"}` > 3600 → data is more than 1 hour old
   - `http_request_duration_ms` p95 > 2000ms → API is slow

---

## Local Development

For local metrics inspection, you can run Prometheus and Grafana with Docker:

```bash
docker-compose up prometheus grafana
```

Add this to `docker-compose.yml`:

```yaml
prometheus:
  image: prom/prometheus
  ports:
    - "9091:9090"
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml

grafana:
  image: grafana/grafana
  ports:
    - "3001:3000"
```

And `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: validds
    static_configs:
      - targets: ['host.docker.internal:9090']
```
