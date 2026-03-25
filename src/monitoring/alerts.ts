import { logger } from '../logger';

const log = logger.child({ module: 'alerts' });

/**
 * Alert triggers for critical system events.
 *
 * V1: Logs alerts locally + optionally posts to a Slack webhook.
 * Set SLACK_ALERT_WEBHOOK in .env to enable Slack notifications.
 *
 * Extensible: add PagerDuty, email, or SMS here as the product matures.
 */

export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  title: string;
  message: string;
  severity: AlertSeverity;
  context?: Record<string, unknown>;
}

export async function sendAlert(alert: Alert): Promise<void> {
  // Always log the alert locally
  if (alert.severity === 'critical') {
    log.error(`[ALERT] ${alert.title}: ${alert.message}`, undefined, alert.context);
  } else {
    log.warn(`[ALERT] ${alert.title}: ${alert.message}`, alert.context);
  }

  // Slack webhook (optional)
  const webhookUrl = process.env.SLACK_ALERT_WEBHOOK;
  if (webhookUrl) {
    try {
      const emoji = alert.severity === 'critical' ? '🔴' : '🟡';
      const payload = {
        text: `${emoji} *[${alert.severity.toUpperCase()}] ${alert.title}*\n${alert.message}`,
        ...(alert.context
          ? {
              attachments: [
                {
                  color: alert.severity === 'critical' ? '#FF0000' : '#FFA500',
                  text: JSON.stringify(alert.context, null, 2),
                },
              ],
            }
          : {}),
      };

      // Use native fetch (Node 18+) — no axios dependency needed here
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      log.error('Failed to send Slack alert', err);
    }
  }
}

// ── Pre-built alert helpers ─────────────────────────────────────────────────

export const Alerts = {
  ingestionFailed: (source: string, err: unknown) =>
    sendAlert({
      title: 'Ingestion Failed',
      message: `Data ingestion from "${source}" failed.`,
      severity: 'critical',
      context: { source, error: String(err) },
    }),

  fallbackActivated: (primary: string, fallback: string) =>
    sendAlert({
      title: 'Fallback Source Activated',
      message: `Primary source "${primary}" unavailable. Switched to "${fallback}".`,
      severity: 'warning',
      context: { primary, fallback },
    }),

  staleDataDetected: (entity: string, ageMinutes: number) =>
    sendAlert({
      title: 'Stale Data Detected',
      message: `${entity} data is ${ageMinutes} minutes old — exceeds freshness threshold.`,
      severity: 'warning',
      context: { entity, ageMinutes },
    }),

  databaseUnhealthy: (err: unknown) =>
    sendAlert({
      title: 'Database Unhealthy',
      message: 'MongoDB health check failed.',
      severity: 'critical',
      context: { error: String(err) },
    }),
};
