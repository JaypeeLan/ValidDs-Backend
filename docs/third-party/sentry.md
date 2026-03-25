# Sentry — Setup Guide

## What It Is

Sentry captures errors and exceptions from the running application in real time. When something breaks in production, Sentry records the full stack trace, request context, and user info so you can debug it without digging through logs.

ValidDs uses the **free tier** which gives you 5,000 errors per month — more than enough for V1.

---

## Step 1: Create an Account

1. Go to [https://sentry.io](https://sentry.io)
2. Click **Get Started** and sign up with GitHub or email
3. Complete the onboarding — you will be asked to create an **organisation**
   - Name it something like `supreme-ecom` or `validds`

---

## Step 2: Create a Project

1. From the Sentry dashboard, click **Projects** in the left sidebar
2. Click **Create Project**
3. Select **Node.js** as the platform
4. Set the alert frequency to **On every new issue**
5. Name the project `validds-backend`
6. Click **Create Project**

---

## Step 3: Get Your DSN

After creating the project, Sentry shows you a **DSN** (Data Source Name). It looks like:

```
https://abc123xyz@o123456.ingest.sentry.io/7891234
```

Copy this — it is your unique project identifier.

If you need to find it later:
1. Go to **Settings** → **Projects** → `validds-backend`
2. Click **Client Keys (DSN)**

---

## Step 4: Set Your Environment Variables

Add these to your `.env` file:

```env
SENTRY_DSN=https://abc123xyz@o123456.ingest.sentry.io/7891234
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=0.1
```

**Environment values:**
- `development` — for local dev (consider setting `SENTRY_DSN` empty locally to avoid noise)
- `staging` — for Render staging deployments
- `production` — for live production

**Traces sample rate:**
- `0.1` means 10% of requests are traced for performance monitoring
- Set to `0.0` to disable performance tracing (saves quota)
- Set to `1.0` for full tracing (uses quota faster)

---

## Step 5: Verify It Is Working

Start the dev server, then deliberately trigger an error:

```bash
curl http://localhost:3000/api/v1/this-does-not-exist
```

Check your Sentry dashboard — you should see the 404 event appear within a few seconds.

To test a real error, you can temporarily add `throw new Error('test sentry')` to any route handler and call it.

---

## Setting Up Alerts

By default, Sentry sends email alerts for new issues. To set up Slack alerts:

1. Go to **Settings** → **Integrations**
2. Search for **Slack** and click **Add to Slack**
3. Authorise Sentry to post to your workspace
4. Go to **Alerts** → **Create Alert Rule**
5. Configure: trigger on **New Issue**, notify via Slack

---

## Free Tier Limits

| Limit | Value |
|---|---|
| Errors/month | 5,000 |
| Performance transactions | 10,000 |
| Team members | Unlimited |
| Data retention | 30 days |
| Projects | Unlimited |

---

## What Gets Sent to Sentry

The application sends to Sentry:
- Unhandled exceptions and promise rejections
- HTTP 5xx errors
- Manual `captureError()` calls in critical paths

**What is explicitly stripped before sending:**
- `Authorization` header (JWT tokens)
- `X-Api-Key` header
- `Cookie` header

This stripping is configured in `src/monitoring/sentry.ts` in the `beforeSend` hook.

---

## Environments

It is good practice to create separate Sentry environments so dev noise does not pollute production alerts:

- Set `SENTRY_ENVIRONMENT=development` in local `.env`
- Set `SENTRY_ENVIRONMENT=staging` in Render staging environment variables
- Set `SENTRY_ENVIRONMENT=production` in Render production environment variables

You can then filter by environment in the Sentry dashboard.
