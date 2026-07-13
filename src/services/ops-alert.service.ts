/**
 * Ops / billing alerts via Resend.
 *
 * Routing (mirrors scraper job_alert):
 *  - paymentRequired / credits / RapidAPI rate-limit (429) → SCRAPER_ALERT_EMAIL
 *  - everything else → SCRAPER_OPS_ALERT_EMAIL (default jplaniran01@gmail.com)
 */
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'ops-alert' });

const DEFAULT_OPS_ALERT_EMAIL = 'jplaniran01@gmail.com';

const lastSent = new Map<string, number>();
const COOLDOWN_MS =
  Math.max(
    5,
    Number(
      process.env.OPS_ALERT_COOLDOWN_MINUTES || process.env.SCRAPER_ALERT_COOLDOWN_MINUTES || 30,
    ),
  ) *
  60 *
  1000;

function parseEmailList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const addr = part.trim();
    if (!addr || !addr.includes('@')) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

/** Full list for payment/credits alerts. */
function parseBillingRecipients(): string[] {
  const raw =
    (process.env.OPS_ALERT_EMAIL || process.env.SCRAPER_ALERT_EMAIL || '').trim() ||
    (process.env.SCRAPER_ALERT_EMAILS || '').trim();
  return parseEmailList(raw);
}

/** Ops-only recipients (reconcile-style / non-billing). */
function parseOpsRecipients(): string[] {
  const raw = (process.env.SCRAPER_OPS_ALERT_EMAIL || process.env.OPS_OPS_ALERT_EMAIL || '').trim();
  return parseEmailList(raw || DEFAULT_OPS_ALERT_EMAIL);
}

function isPaymentRequiredIssue(issue: string, detail?: string): boolean {
  /** Credits exhaustion or RapidAPI-style rate-limit / quota (429). */
  const msg = `${issue}\n${detail || ''}`.toLowerCase();
  return [
    'http 402',
    'payment required',
    'insufficient credit',
    'out of credits',
    'no credits',
    'credits exhausted',
    'not enough credit',
    'http 429',
    'rate limit',
    'rate-limit',
    'api rate limited',
    'upgrade plan',
  ].some((t) => msg.includes(t));
}

function shouldSend(dedupeKey: string): boolean {
  const now = Date.now();
  const prev = lastSent.get(dedupeKey) ?? 0;
  if (now - prev < COOLDOWN_MS) return false;
  lastSent.set(dedupeKey, now);
  return true;
}

export async function sendOpsAlert(input: {
  issue: string;
  service?: string;
  detail?: string;
  fix?: string[];
  dedupeKey?: string;
  /** Override routing. Default: auto-detect payment/credits from issue/detail. */
  audience?: 'auto' | 'ops' | 'billing';
}): Promise<boolean> {
  const dedupeKey = input.dedupeKey || input.issue;
  if (!shouldSend(dedupeKey)) {
    log.debug({ dedupeKey }, 'ops alert suppressed (cooldown)');
    return false;
  }

  const audience = input.audience ?? 'auto';
  const useBilling =
    audience === 'billing' ||
    (audience === 'auto' && isPaymentRequiredIssue(input.issue, input.detail));
  const recipients = useBilling ? parseBillingRecipients() : parseOpsRecipients();
  const apiKey = process.env.RESEND_API_KEY || env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || env.RESEND_FROM;
  if (!recipients.length || !apiKey || !from) {
    log.warn(
      {
        hasRecipients: recipients.length > 0,
        hasKey: Boolean(apiKey),
        hasFrom: Boolean(from),
        audience: useBilling ? 'billing' : 'ops',
      },
      useBilling
        ? 'billing alert skipped — set SCRAPER_ALERT_EMAIL + RESEND_API_KEY + RESEND_FROM'
        : 'ops alert skipped — set RESEND_API_KEY + RESEND_FROM (ops defaults to jplaniran01@gmail.com)',
    );
    return false;
  }

  const service = input.service || process.env.ALERT_SERVICE_NAME || 'backend';
  const lines = [
    `ISSUE: ${input.issue}`,
    `Service: ${service}`,
    input.detail ? `Detail: ${input.detail}` : '',
    ...(input.fix?.length ? ['', 'FIX:', ...input.fix.map((s, i) => `${i + 1}. ${s}`)] : []),
  ].filter(Boolean);

  const text = lines.join('\n');
  const subject = `[ValidDs ${service}] ISSUE: ${input.issue}`.slice(0, 140);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ValidDs-Backend/1.0 (+https://validds.com; ops-alerts)',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text,
        html: `<pre style="font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;font-size:13px">${text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</pre>`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log.warn({ status: res.status, body: body.slice(0, 300) }, 'ops alert Resend failed');
      return false;
    }
    log.info(
      { to: recipients, issue: input.issue, audience: useBilling ? 'billing' : 'ops' },
      'ops alert emailed',
    );
    return true;
  } catch (err) {
    log.warn({ err }, 'ops alert send failed');
    return false;
  }
}
