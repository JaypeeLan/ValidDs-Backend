# ValidDs Backend — Monitoring & Failure Handling

This document explains exactly how the backend ingestion pipeline acts when dependencies fail, how we track these errors, and how we notify engineers.

---

## 1. Third-Party Failure Behavior

The entire pipeline revolves around the Orchestrator logic. Because we scrape external social platforms and rely upon heavy AI models, failure is treated as a routine expectation instead of an anomaly.

### Data Acquisition Failures (TikTok / ingestion)
- **Timeouts/Empty Responses**: Trigger automatic retries internally within the source integrations (`fetch` with explicit `AbortSignal` timeout handling). 
- **Endpoint Failures**: If scraping data completely fails midway, the Orchestrator skips the specific entity/post and prevents it from overwriting healthy data in MongoDB, letting the product remain accessible via the `cache` or last known healthy DB snapshot.

### LLM Failures (Product Validation)
Due to heavy strict-output JSON requests against OpenAI and DeepSeek, extraction generation has a failure curve.
- **Provider Chain**: Designed with cost and fallback logic. The application calls `DeepSeek API` dynamically first. If it returns `503 Service Unavailable`, or if credits expire, the system immediately fails-over to `OpenAI` to guarantee the job finishes.
- **Bad Formats**: If an LLM returns improperly formatted JSON or hallucinates the schema, the specific product extraction fails and drops that single video, letting the broader pipeline continue processing.

---

## 2. Freshness & Stale-Data Recovery

The system utilizes an internal `FreshnessService` mapping.

- **`dataSourceUpdatedAt`**: Tracks when the *original* post/product was created externally.
- **`lastIngestedAt`**: Tracks exactly when our DB successfully pulled updates.
- **`isStale` Boolean Switch**: If data has not successfully passed the Orchestrator into the database within 48 hours, it gets marked `isStale = true`. 
- **Frontend Action**: When a product payload is requested, the payload includes a `{ "freshness": { "lastUpdated", "ageMinutes" } }` metadata block. The frontend will dynamically show users a "Data is currently delayed" banner rather than showing them 48-hour-old metrics disguised as live data.

---

## 3. General Monitoring Matrix

ValidDs incorporates three primary observability layers.

| Platform | Use Case | Responsibility |
|----------|----------|----------------|
| **Sentry** | Exceptions | Captures fatal Node.js crashes, unhandled Promises, and Express routing timeouts. Traces request variables immediately upon 500 errors. |
| **Pino / Console** | Audit Trails | Real-time debugging via structured JSON formatting. Logs pipeline progression (e.g. `[INFO] Successfully extracted 15 videos...`). |

### Who Gets Alerted?
For V1, Sentry is configured to notify the engineering/operations team when crash volumes surpass normal hourly thresholds. Automated Rollbacks are not configured; issues must be triaged directly via the render dashboard or server console logs.
