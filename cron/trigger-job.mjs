#!/usr/bin/env node
/**
 * POST a background job on the ValidDs API (for Render Cron / GitHub Actions / crontab).
 *
 * Usage:
 *   node cron/trigger-job.mjs <job>
 *
 * Jobs: product-ingestion | creative-ingestion | stale-cleanup | live-monitor-discover | product-refresh
 *
 * Env:
 *   CRON_BACKEND_URL or BACKEND_URL — e.g. https://api.example.com (no trailing slash)
 *   INTERNAL_API_KEY — X-API-Key value
 *   API_VERSION — default v1
 */

const JOBS = new Set([
  'product-ingestion',
  'creative-ingestion',
  'stale-cleanup',
  'live-monitor-discover',
  'product-refresh',
]);

const job = process.argv[2];
if (!job || !JOBS.has(job)) {
  console.error(`Usage: node cron/trigger-job.mjs <${[...JOBS].join('|')}>`);
  process.exit(2);
}

const base = (process.env.CRON_BACKEND_URL || process.env.BACKEND_URL || '').replace(/\/$/, '');
const apiKey = process.env.INTERNAL_API_KEY || '';
const apiVersion = process.env.API_VERSION || 'v1';

if (!base) {
  console.error('Missing CRON_BACKEND_URL or BACKEND_URL');
  process.exit(1);
}
if (!apiKey) {
  console.error('Missing INTERNAL_API_KEY');
  process.exit(1);
}

const url = `${base}/api/${apiVersion}/jobs/${job}`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'X-API-Key': apiKey,
    Accept: 'application/json',
    'User-Agent': 'validds-cron/1.0',
  },
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

if (!res.ok) {
  console.error(`[cron] ${job} failed HTTP ${res.status}`, body);
  process.exit(1);
}

console.log(`[cron] ${job} OK`, typeof body === 'object' ? JSON.stringify(body) : body);
