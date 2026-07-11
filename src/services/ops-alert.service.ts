/**
 * Ops alerts for paid third-party failures (Resend → SCRAPER_ALERT_EMAIL).
 * Mirrors scraper job_alert semantics for the Node backend.
 */
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'ops-alert' });

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

function parseRecipients(): string[] {
  const raw =
    (process.env.OPS_ALERT_EMAIL || process.env.SCRAPER_ALERT_EMAIL || '').trim() ||
    (process.env.SCRAPER_ALERT_EMAILS || '').trim();
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
}): Promise<boolean> {
  const dedupeKey = input.dedupeKey || input.issue;
  if (!shouldSend(dedupeKey)) {
    log.debug({ dedupeKey }, 'ops alert suppressed (cooldown)');
    return false;
  }

  const recipients = parseRecipients();
  const apiKey = process.env.RESEND_API_KEY || env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || env.RESEND_FROM;
  if (!recipients.length || !apiKey || !from) {
    log.warn(
      {
        hasRecipients: recipients.length > 0,
        hasKey: Boolean(apiKey),
        hasFrom: Boolean(from),
      },
      'ops alert skipped — set SCRAPER_ALERT_EMAIL + RESEND_API_KEY + RESEND_FROM',
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
    log.info({ to: recipients, issue: input.issue }, 'ops alert emailed');
    return true;
  } catch (err) {
    log.warn({ err }, 'ops alert send failed');
    return false;
  }
}
