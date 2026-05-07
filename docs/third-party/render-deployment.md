# Render — Deployment Guide

## What It Is

Render is a cloud platform for deploying web services. ValidDs uses Render's **free tier** for test deployment. The free tier spins the service down after 15 minutes of inactivity and takes ~30 seconds to spin back up on the next request — this is acceptable for development and staging.

---

## Step 1: Create an Account

1. Go to [https://render.com](https://render.com)
2. Sign up with GitHub (recommended — enables automatic deploys) or email

---

## Step 2: Connect Your Repository

1. In the Render dashboard, click **New +** → **Web Service**
2. Connect your GitHub account if not already connected
3. Select the `validds-backend` repository
4. If the repository is private, grant Render access to it

---

## Step 3: Configure the Service

Fill in the configuration form:

| Field | Value |
|---|---|
| **Name** | `validds-backend` |
| **Region** | US East (Ohio) — closest to MongoDB Atlas `us-east-1` |
| **Branch** | `main` (or your deploy branch) |
| **Runtime** | Node |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | Free |

Click **Create Web Service**.

---

## Step 4: Set Environment Variables

After creating the service, go to **Environment** in the left sidebar.

Add all variables from your `.env` file. **Never paste your actual `.env` file** — enter each key-value pair manually.

Required variables for deployment:

```
NODE_ENV=production
PORT=3000
APP_NAME=validds-backend
API_VERSION=v1
INTERNAL_API_KEY=<generate with npm run generate-api-key>
JWT_SECRET=<32+ character random string>
ENCRYPTION_KEY=<64 hex chars>
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
MONGODB_URI=<your Atlas connection string>
MONGODB_DB_NAME=validds
REDIS_URL=<your Redis connection string>
SENTRY_DSN=<your Sentry DSN>
SENTRY_ENVIRONMENT=staging
LOG_LEVEL=info
LOG_PRETTY=false
```

Set `LOG_PRETTY=false` in production — JSON output is easier to parse in Render's log viewer.

---

## Step 5: Configure the Health Check

Render uses health checks to know when your service is ready to receive traffic.

1. Go to **Settings** → **Health & Alerts**
2. Set **Health Check Path** to `/health`
3. Set the timeout to `30` seconds (to allow startup time on cold boots)

---

## Step 6: Deploy

Render automatically deploys when you push to the configured branch. You can also trigger a manual deploy:

1. Go to your service in the Render dashboard
2. Click **Manual Deploy** → **Deploy latest commit**

Watch the **Logs** tab to see the startup sequence.

---

## Verifying the Deployment

Once deployed, your service URL will be something like:
```
https://validds-backend.onrender.com
```

Test it:
```bash
curl https://validds-backend.onrender.com/health
curl https://validds-backend.onrender.com/ready
```

---

## Free Tier Behaviour

| Behaviour | Detail |
|---|---|
| Sleep after inactivity | 15 minutes of no requests → service sleeps |
| Cold start time | ~30 seconds for the first request after sleep |
| Build minutes | 400/month free |
| Bandwidth | 100 GB/month free |
| Custom domains | Supported on free tier |

**Note on MongoDB Atlas IP whitelist:** Render free tier does not provide a static outbound IP. This means you must set MongoDB Atlas Network Access to `0.0.0.0/0` (allow all). This is acceptable for staging. For production, upgrade to Render paid tier (provides static IP) and restrict Atlas to that IP.

---

## Automatic Deploys

With GitHub connected, Render will automatically redeploy on every push to `main`. To disable this:

1. Go to **Settings** → **Build & Deploy**
2. Toggle off **Auto-Deploy**

---

## Viewing Logs

1. In your service dashboard, click **Logs**
2. Logs stream in real time
3. Use the search bar to filter by keyword (e.g. `ERROR`, `requestId`)

Since `LOG_PRETTY=false` in production, logs are JSON — use Render's filter or pipe to `jq` locally if needed.

---

## Troubleshooting

**Service keeps failing to start**
- Check the Logs tab for the exact error
- Most common cause: a missing or incorrect environment variable (the Zod validation will print which one)

**Health check failing**
- Make sure the `PORT` environment variable is set to `3000` in Render
- Check that the `/health` endpoint returns 200

**MongoDB connection timeout**
- Ensure `0.0.0.0/0` is whitelisted in MongoDB Atlas Network Access
- Verify the `MONGODB_URI` is correct and URL-encoded

**Cold start is too slow**
- This is a free tier limitation — consider upgrading to Render Starter ($7/month) to keep the service always-on
