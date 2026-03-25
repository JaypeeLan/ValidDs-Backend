# Upstash Redis — Setup Guide

## What It Is

Upstash is a serverless Redis service with a **free tier** that gives you 10,000 commands per day and 256MB of storage. ValidDs uses it for:

- **Caching** — product feed and detail responses to reduce database load
- **Rate limiting** — tracking request counts per IP
- **Job queues** — BullMQ background jobs for data ingestion

---

## Step 1: Create an Account

1. Go to [https://upstash.com](https://upstash.com)
2. Sign up with GitHub, Google, or email
3. Verify your email if prompted

---

## Step 2: Create a Redis Database

1. From the dashboard, click **Create Database**
2. Name it `validds-redis` (or any name you prefer)
3. Select **Regional** type
4. Choose a region close to your deployment (e.g. `us-east-1` for Render US East)
5. Leave **TLS** enabled — this is required for secure connections
6. Click **Create**

---

## Step 3: Get Your Connection URL

1. Click on your newly created database
2. Go to the **Details** tab
3. Find the **Redis URL** — it looks like:
   ```
   rediss://default:<password>@<endpoint>.upstash.io:6379
   ```
   Note: `rediss://` (with double `s`) means TLS is enabled. This is correct.

4. Alternatively, go to the **.env** tab — Upstash generates a ready-to-use `.env` snippet for you.

---

## Step 4: Set Your Environment Variable

Add this to your `.env` file:

```env
REDIS_URL=rediss://default:<password>@<endpoint>.upstash.io:6379
```

---

## Step 5: Verify the Connection

Start the dev server:

```bash
npm run dev
curl http://localhost:3000/ready
```

You should see `"redis": { "status": "ok" }` in the response.

You can also verify from the Upstash dashboard — the **Data Browser** tab lets you see stored keys in real time.

---

## Free Tier Limits

| Limit | Value |
|---|---|
| Commands/day | 10,000 |
| Max data size | 256 MB |
| Max connections | 100 concurrent |
| Bandwidth | 200 MB/day |
| Databases | 1 |

For V1 development and staging, this is sufficient. If you exceed 10,000 commands/day during testing, consider:
- Increasing cache TTLs to reduce Redis calls
- Upgrading to Upstash Pay-as-you-go ($0.20 per 100k commands)

---

## BullMQ Note

BullMQ requires a **separate Redis connection** that it fully controls. The codebase handles this automatically in `src/cache/redis.client.ts` via the `createBullMQRedisConnection()` function. You do not need a second Upstash database — both connections use the same `REDIS_URL`.

---

## Troubleshooting

**ECONNREFUSED or TLS errors**
- Confirm your URL starts with `rediss://` (double s), not `redis://`
- Upstash free tier requires TLS — plain TCP connections are rejected

**Max daily commands reached**
- Check the Upstash dashboard for usage stats
- Increase cache TTLs to reduce the number of SET/GET calls
- Consider adding a local in-process cache (LRU) in front of Redis for hot data

**Connection works locally but fails on Render**
- Upstash allows connections from any IP by default — no IP whitelist needed
