# Known Risks and Open Issues

Last updated: 2026-03-23

---

## Risk Register

### R-001 — TikTok Data Access Risk
**Severity:** Critical
**Status:** Open — being resolved in Week 1

**Description:**
TikTok's official API has strict access controls and is not publicly available for product/creator data at the level ValidDs needs. The primary data acquisition path is not yet confirmed.

**Mitigation:**
- Week 1 deliverable is to confirm primary path and document 2 fallbacks
- Ingestion layer is designed with a 3-source orchestrator precisely for this risk
- If all API/data paths are blocked, a scraping-based fallback is possible but slower to implement

**Impact if unresolved:**
No data in the system = no product to show. This is the highest-priority risk in the entire project.

---

### R-002 — Render Free Tier Cold Starts
**Severity:** Low (acceptable for V1)
**Status:** Known, accepted

**Description:**
Render free tier spins down the service after 15 minutes of inactivity. The first request after sleep takes ~30 seconds to respond.

**Mitigation:**
- Not a problem for development and internal testing
- For any real user demo or testing session, manually ping the service before the session to warm it up
- Upgrade to Render Starter ($7/month) when always-on is needed

---

### R-003 — MongoDB Atlas No Static IP
**Severity:** Medium
**Status:** Known, accepted for V1

**Description:**
Render free tier has no static outbound IP. This forces MongoDB Atlas network access to `0.0.0.0/0` (allow all), which is not ideal for a production database.

**Mitigation:**
- MongoDB credentials are strong and unique — the database itself is still password-protected
- TLS is enforced on the Atlas connection
- For production: upgrade Render to a paid plan with static IP, then restrict Atlas to that IP

---

### R-004 — Upstash Free Tier Command Limit
**Severity:** Low
**Status:** Monitored

**Description:**
Upstash free tier allows 10,000 Redis commands per day. Heavy testing or large ingestion jobs could exhaust this.

**Mitigation:**
- Monitor via Upstash dashboard
- If hit: temporarily disable caching in dev, or upgrade to pay-as-you-go
- Cache TTLs are set conservatively to reduce command volume

---

### R-005 — No Automated Database Backups on M0
**Severity:** Medium
**Status:** Accepted for staging; needs resolution before production

**Description:**
MongoDB Atlas M0 free tier has no automated backups. If data is corrupted or accidentally deleted, it cannot be recovered.

**Mitigation:**
- V1 data is ingested from external sources — it can be re-ingested if lost
- Before production launch, upgrade to M2+ (which includes daily backups)
- Alternatively, write a manual backup script that exports to S3 on a schedule

---

### R-006 — Single-Instance Deployment
**Severity:** Low (V1)
**Status:** Accepted

**Description:**
Render free tier runs a single instance. No horizontal scaling, no load balancing.

**Mitigation:**
- Sufficient for V1 user load
- Redis-backed rate limiting and caching reduce per-request DB load
- For scale: Render supports multi-instance deployments on paid plans

---

### R-007 — Freshness Dependency on Ingestion Reliability
**Severity:** Medium
**Status:** Managed by freshness layer

**Description:**
If ingestion jobs fail silently, the frontend continues serving stale data without warning.

**Mitigation:**
- FreshnessService tracks last-updated timestamps per entity
- Stale data thresholds trigger Slack/webhook alerts
- `/ready` endpoint reflects data health (can be extended)
- Prometheus `data_freshness_seconds` metric is dashboarded

---

## Intentionally Deferred

The following items are known gaps that are deferred to post-V1:

| Item | Reason deferred |
|---|---|
| User authentication / accounts | Not needed for V1 data API |
| Multi-region deployment | V1 is single-region only |
| Automated database backups | Requires paid Atlas tier |
| Static outbound IP | Requires paid Render tier |
| End-to-end API tests | Unit + integration tests cover V1 |
| Supplier sourcing logic | Data source not confirmed yet |
| Competitor store deep crawl | Out of scope for V1 ingestion |
