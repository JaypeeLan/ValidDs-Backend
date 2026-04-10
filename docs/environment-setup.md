# ValidDs Backend — Environment & Setup

This document outlines the required services, necessary environment variable setup, local development process, and deployment constraints for the ValidDs V1 backend API.

---

## 1. Required Services

To run the backend locally or in production, you need the following active services connected via your `.env` variables:

1. **MongoDB Atlas**
   - Serves as the primary NoSQL datastore for products, users, and telemetry logs.
   - Requires at least an M0 (Free Tier) cluster for local development.

2. **Upstash Redis (Serverless)**
   - Used for caching frequent API requests (like product feeds) and request rate limiting.
   - Any Redis-compatible connection works (e.g. `redis://localhost:6379` locally).

3. **External API Providers**
   - **EnsembleData**: For scraping TikTok data and orchestrating keyword/hashtag lookups.
   - **Rainforest API**: For enriching dropshipping data directly from Amazon (Prices, High-res Images, Ratings).
   - **DeepSeek API (or OpenAI)**: For performing LLM extraction and intent validation asynchronously.

---

## 2. Setting Up the `.env` File

Copy `.env.example` to `.env` in the root directory.

### Structural Requirements

| Variable Group | Examples | Purpose |
|----------------|----------|---------|
| **Core API** | `PORT`, `NODE_ENV` | Define environment bounds and host port bindings. |
| **Security** | `INTERNAL_API_KEY`, `JWT_SECRET`, `ENCRYPTION_KEY` | Handle request validations and encrypt sensitive stored DB tokens. |
| **Infrastructure** | `MONGODB_URI`, `REDIS_URL` | Map to your active managed databases. |
| **Data Scraping** | `ENSEMBLE_API_KEY`, `RAINFOREST_API_KEY` | Power the ingestion pipeline's core extraction capabilities. |
| **AI Extraction** | `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` | Handle psychology abstraction and scoring inside the pipeline. |

---

## 3. Running Locally

**Prerequisites:** 
- Node.js (v18+)
- Local or Cloud Redis
- Local or Cloud MongoDB instance

**Steps:**
1. Run `npm install` to load all packages.
2. Compile and ensure TypeScript types resolve: `npm run build`.
3. Start the hot-reloading development server:
   ```bash
   npm run dev
   ```
4. Verify the system is healthy via `GET http://localhost:3000/api/v1/health`

**Triggering Ingestion Locally:**
To safely trigger a manual ingest of new trending products without hitting API endpoints, run:
```bash
npm run hashtag-pipeline
```

---

## 4. Deployment Assumptions

V1 is deployed on **Render** (via auto-deploy Web Service integration hooked to the `main` GitHub branch) under the Node 18+ runtime.

### Specific Render Configurations:
- **Build Command:** `npm install && npm run build`
- **Start Command:** `node dist/server.js`
- **Single Instance:** V1 runs on a single node (Render Free/Starter tier). Ensure caching handles traffic spikes because there is no horizontal scaling configured.
- **Cold Starts:** If deploying on the free tier, the first request after 15 minutes of inactivity will suffer a ~30 second cold start delay while the instance boots.
- **IP Allowlisting:** Render Free does not offer static IP addresses. You must allow `0.0.0.0/0` in your MongoDB Atlas Network rules.
