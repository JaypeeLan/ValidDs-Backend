# Data Ingestion Architecture

ValidDs sources product data from TikTok via RapidAPI and uses AI to extract structured product information. This document covers the data pipeline from collection through extraction.

## Overview

```
TikTok Creative Center (RapidAPI)
         ↓
  Fetch & Parse (4 endpoints)
         ↓
  Store Raw Posts (MongoDB)
         ↓
  AI Product Extraction (Multi-Provider)
         ↓
  Save Extracted Products (MongoDB)
         ↓
  Update Freshness Metadata
         ↓
  Cache Invalidation & Response
```

## Data Sources

### Primary: TikTok Creative Center (RapidAPI)

The system collects trending TikTok data through RapidAPI's TikTok Creative Center endpoint.

**Base URL:** `https://tiktok-creative-center-api.p.rapidapi.com`

**Authentication:**
- Header: `x-rapidapi-key`
- Header: `x-rapidapi-host: tiktok-creative-center-api.p.rapidapi.com`
- Environment variable: `RAPIDAPI_KEY`

**Endpoints:**

| Endpoint | Purpose | Response Structure | Rate Limit |
|----------|---------|-------------------|-----------|
| `/api/trending/ads` | Top performing TikTok ads | `{ data: { materials: [...] } }` | ~100/day |
| `/api/trending/video` | Trending videos | `{ data: { videos: [...] } }` | ~100/day |
| `/api/trending/hashtag` | Trending hashtags | `{ data: { list: [...] } }` | ~100/day |
| `/api/trending/keyword` | Keyword trends | `{ data: { list: [...] } }` | ~100/day |

**Response Parsing:**

The API returns nested structures that vary by endpoint. The client handles this with flexible fallback parsing:

```typescript
// Try multiple possible locations for the actual data
const items = data?.data?.materials    // Used by /ads
           ?? data?.data?.videos       // Used by /video
           ?? data?.data?.list         // Used by /hashtag, /keyword
           ?? data?.data               // Fallback for unexpected structure
           ?? [];
```

This approach makes the system resilient to minor API changes.

### Configuration

**File:** `src/ingestion/creative-center/creative-center.client.ts`

**Key Class:** `CreativeCenterClient`

```typescript
constructor(private apiKey: string) {
  this.baseUrl = 'https://tiktok-creative-center-api.p.rapidapi.com';
  this.headers = {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': 'tiktok-creative-center-api.p.rapidapi.com',
  };
}
```

**Methods:**
- `fetchTopAds()` — Get top 20 performing ads
- `fetchTrendingVideos()` — Get 20 trending videos
- `fetchTrendingHashtags()` — Get trending hashtags
- `fetchTrendingKeywords()` — Get trending keywords

**Error Handling:**
- Transient errors (5xx) are retried up to 3 times with exponential backoff
- Rate limit errors (429) are logged and contribute to freshness alerts
- Parsing errors are caught and logged — the system continues with partial data

## Orchestrator Pattern

The ingestion orchestrator (`src/ingestion/orchestrator.ts`) manages the complete pipeline:

```typescript
async function ingest() {
  1. Collect data from all sources
  2. For each post:
     a. Attempt AI extraction (with fallback chain)
     b. Save to database
     c. Update freshness timestamp
  3. Log results and trigger alerts if needed
}
```

**Key Points:**
- **Idempotent:** Re-running ingestion doesn't create duplicates (posts are identified by source + ID)
- **Resilient:** Single source failure doesn't block the entire pipeline
- **Observable:** All steps are logged with structured JSON

## Product Extraction

### AI Provider Fallback Chain

Product extraction uses a cost-optimized multi-provider system. The system attempts extraction in order and falls back if a provider fails or lacks credentials:

1. **DeepSeek API** (Primary)
   - Cost: ~$0.10/post (lowest)
   - Model: `deepseek-chat`
   - Parallelization: Batch up to 10 requests
   - Environment: `DEEPSEEK_API_KEY`
   - Endpoint: `https://api.deepseek.com/chat/completions`

2. **Anthropic Claude** (Fallback 1)
   - Cost: ~$0.30/post
   - Model: `claude-3-5-sonnet-20241022`
   - Batching: Sequential (rate limited)
   - Environment: `ANTHROPIC_API_KEY`
   - Endpoint: Anthropic SDK

3. **OpenAI GPT-4o-mini** (Fallback 2)
   - Cost: ~$0.15/post
   - Model: `gpt-4o-mini`
   - Batching: Sequential
   - Environment: `OPENAI_API_KEY`
   - Endpoint: OpenAI SDK

### Fallback Logic

```typescript
async callProvider(postText: string, provider?: string) {
  const providers = this.PROVIDERS; // Ordered by preference

  for (const p of providers) {
    // Skip if API key missing
    if (!process.env[p.apiKey]) continue;

    // Skip if specific provider requested but this isn't it
    if (provider && p.name !== provider) continue;

    try {
      return await this.callSpecific(p, postText);
    } catch (error) {
      logger.warn(`Provider ${p.name} failed, trying next...`, { error });
      continue; // Try next provider
    }
  }

  // All providers exhausted
  return null;
}
```

**Behavior:**
- If `DEEPSEEK_API_KEY` exists → Use DeepSeek
- Else if `ANTHROPIC_API_KEY` exists → Use Anthropic
- Else if `OPENAI_API_KEY` exists → Use OpenAI
- Else → Skip extraction, log warning

### Extraction Prompt

All providers receive the same extraction request (adapted to their API format):

```
Extract structured product data from this TikTok post:
{post_text}

Return a JSON object with:
{
  "productName": "string",
  "description": "string (2-3 sentences)",
  "price": "string (with currency if visible)",
  "category": "string",
  "hashtags": ["string"],
  "mentions": ["string"],
  "sentiment": "positive|neutral|negative",
  "callToAction": "string or null"
}

Be strict: only extract information explicitly stated in the post.
If any field cannot be determined, use null.
```

### Extraction Output

On success, the system saves:

```typescript
interface ExtractedProduct {
  title: string;              // productName
  description: string;
  price?: string;
  category?: string;
  tags: string[];             // hashtags
  mentions: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  callToAction?: string;
  source: 'tiktok';
  sourcePostId: string;       // Original TikTok post ID
  extractedAt: Date;
  aiProvider: 'deepseek' | 'anthropic' | 'openai'; // Which provider succeeded
}
```

### Cost Optimization

At 40 posts/day (typical ingestion volume):

| Scenario | Daily Cost | Monthly Cost |
|----------|-----------|--------------|
| All DeepSeek (best case) | $4.00 | ~$120 |
| 80% DeepSeek, 20% Anthropic | $10.00 | ~$300 |
| All Anthropic | $12.00 | ~$360 |
| All OpenAI (worst case) | $6.00 | ~$180 |

The multi-provider approach combines **availability** (doesn't rely on single provider) with **cost optimization** (uses cheapest provider when available).

### Implementation

**File:** `src/services/product.extractor.ts`

**Key Class:** `ProductExtractor`

```typescript
private PROVIDERS = [
  {
    name: 'deepseek',
    apiKey: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    format: 'openai', // Uses OpenAI chat completion format
  },
  {
    name: 'anthropic',
    apiKey: 'ANTHROPIC_API_KEY',
    model: 'claude-3-5-sonnet-20241022',
    format: 'anthropic', // Anthropic-specific format
  },
  {
    name: 'openai',
    apiKey: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini',
    format: 'openai',
  },
];

// Main extraction method
async extractProduct(text: string): Promise<ExtractedProduct | null> {
  const result = await this.callProvider(text);
  if (!result) return null;

  return {
    title: result.productName,
    description: result.description,
    // ... map other fields
  };
}

// Fallback logic
private async callProvider(text: string) {
  for (const provider of this.PROVIDERS) {
    if (!process.env[provider.apiKey]) continue;

    try {
      if (provider.format === 'openai') {
        return await this.callOpenAIFormat(provider, text);
      } else if (provider.format === 'anthropic') {
        return await this.callAnthropicFormat(provider, text);
      }
    } catch (error) {
      logger.warn(`${provider.name} failed`, { error });
      continue;
    }
  }
  return null;
}
```

## Freshness Tracking

The system tracks when product data was last updated. This enables:

1. **Staleness alerts** — Alert when data hasn't been refreshed in 24+ hours
2. **Frontend indicators** — Show "last updated 2 hours ago" to users
3. **Cache invalidation** — Know when to bust Redis cache

**File:** `src/freshness/freshness.service.ts`

**Metadata stored:**

```typescript
interface Freshness {
  entityType: 'products' | 'trends' | 'hashtags';
  lastSuccessfulUpdate: Date;
  nextScheduledUpdate: Date;
  successCount: number;
  failureCount: number;
  failureReason?: string;
}
```

## Database Schema

### Raw Posts Collection

```typescript
interface RawPost {
  _id: ObjectId;
  sourceType: 'tiktok_creative_center';
  sourcePostId: string;
  rawData: Record<string, unknown>; // Original API response
  collectedAt: Date;
  extractedAt?: Date; // When extraction was attempted
  extractionStatus: 'pending' | 'success' | 'failed';
  extractedProductId?: ObjectId; // Reference to extracted product
}
```

### Extracted Products Collection

```typescript
interface Product {
  _id: ObjectId;
  title: string;
  description: string;
  price?: string;
  category?: string;
  tags: string[];
  mentions: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  callToAction?: string;
  source: 'tiktok';
  sourcePostId: string;
  extractedAt: Date;
  aiProvider: 'deepseek' | 'anthropic' | 'openai';
  createdAt: Date;
  updatedAt: Date;
}
```

## Monitoring & Alerts

The system logs all extraction activity:

```
{
  "timestamp": "2026-04-01T12:00:00Z",
  "level": "info",
  "message": "Ingestion complete",
  "posts_collected": 40,
  "products_extracted": 20,
  "products_saved": 20,
  "sources": ["creative-center"],
  "extraction_breakdown": {
    "deepseek": 15,
    "anthropic": 5,
    "openai": 0
  }
}
```

Alerts trigger if:
- Extraction success rate < 30% (suggests API issues)
- Collection fails for a source (RapidAPI downtime)
- Average extraction latency > 5s (suggests provider slowdown)
- Cost exceeds daily budget

## Troubleshooting

### High Extraction Costs

**Symptom:** OpenAI costs dominating the bill

**Solution:**
1. Verify `DEEPSEEK_API_KEY` is set
2. Check DeepSeek rate limits aren't being exceeded
3. Monitor provider health on their status pages

### Extraction Failures

**Symptom:** Many "extraction_status: failed" entries

**Check:**
1. API key validity — test with curl
2. Prompt quality — sample a few failures and adjust prompt
3. Timeout values — increase if providers are slow

### Data Collection Gaps

**Symptom:** No posts collected for hours

**Check:**
1. RapidAPI status page — check for API downtime
2. Rate limit — verify you have remaining API calls
3. Logs for auth errors — check API key format

## Configuration

**Environment Variables:**

```bash
# Data collection
RAPIDAPI_KEY=your_rapidapi_key

# AI extraction (at least one required for extraction to work)
DEEPSEEK_API_KEY=optional
ANTHROPIC_API_KEY=optional
OPENAI_API_KEY=optional

# Monitoring
INGESTION_ERROR_WEBHOOK=https://... # Sentry or webhook URL
FRESHNESS_ALERT_THRESHOLD_HOURS=24  # Trigger alert if data > 24h old
```

**Ingestion Scheduling:**

Currently ingestion runs on-demand via `/scripts/test-ingestion.ts` for testing.

For production, add a scheduled job (see `src/jobs/product-refresh.job.ts`):

```typescript
// Daily at 2 AM UTC
schedule.scheduleJob('0 2 * * *', async () => {
  await runIngestion();
});
```

## Future Improvements

1. **Multi-source collection** — Add fallback sources if RapidAPI becomes unavailable
2. **Smarter batching** — Batch AI requests to reduce per-request overhead
3. **Provider selection** — Use ML to predict which provider will succeed fastest
4. **Caching** — Skip re-extraction of identical posts
5. **Post-processing** — Entity linking, duplicate detection, category ML
