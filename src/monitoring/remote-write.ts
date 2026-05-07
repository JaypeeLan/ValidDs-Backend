import { register } from 'prom-client';
import { pushTimeseries } from 'prometheus-remote-write';
import { env } from '../config/env.validation';
import { logger } from '../logger';

const log = logger.child({ module: 'remote-write' });

const PUSH_INTERVAL_MS = 60_000; // 60 seconds

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Converts prom-client's metric registry into Prometheus remote-write
 * timeseries format and pushes it to Grafana Cloud.
 */
async function pushMetricsToGrafana(): Promise<void> {
  if (!env.PROMETHEUS_REMOTE_WRITE_URL || !env.PROMETHEUS_USERNAME || !env.PROMETHEUS_API_KEY) {
    return; // silently skip — config not set
  }

  try {
    const metrics = await register.getMetricsAsJSON();
    const now = Date.now();

    const timeseries: {
      labels: { __name__: string; [key: string]: string };
      samples: { value: number; timestamp: number }[];
    }[] = [];

    for (const metric of metrics) {
      for (const val of metric.values) {
        if (typeof val.value !== 'number' || !isFinite(val.value)) continue;

        // Prometheus requires all label values to be strings
        const labels: { __name__: string; [key: string]: string } = { __name__: metric.name };
        for (const [k, v] of Object.entries(val.labels ?? {})) {
          labels[k] = String(v);
        }

        timeseries.push({
          labels,
          samples: [{ value: val.value, timestamp: now }],
        });
      }
    }

    if (timeseries.length === 0) return;

    await pushTimeseries(timeseries, {
      url: env.PROMETHEUS_REMOTE_WRITE_URL,
      auth: {
        username: env.PROMETHEUS_USERNAME,
        password: env.PROMETHEUS_API_KEY,
      },
      labels: {
        job: env.APP_NAME,
        env: env.NODE_ENV,
      },
    });

    log.debug(`Remote write OK — pushed ${timeseries.length} series`);
  } catch (err) {
    // Non-fatal: log and continue. A single failed push does not break the app.
    log.warn('Prometheus remote write failed', { err });
  }
}

/**
 * Starts the repeating background push to Grafana Cloud.
 * Should be called after metrics are initialised in server.ts.
 */
export function startRemoteWrite(): void {
  if (env.NODE_ENV === 'development') {
    log.info('Prometheus remote write disabled in development mode');
    return;
  }

  if (!env.PROMETHEUS_REMOTE_WRITE_URL) {
    log.info('PROMETHEUS_REMOTE_WRITE_URL not set — remote write disabled');
    return;
  }

  // Push once immediately on startup, then every PUSH_INTERVAL_MS
  pushMetricsToGrafana();
  intervalHandle = setInterval(pushMetricsToGrafana, PUSH_INTERVAL_MS);

  log.info('Prometheus remote write started', {
    url: env.PROMETHEUS_REMOTE_WRITE_URL,
    intervalSeconds: PUSH_INTERVAL_MS / 1000,
  });
}

/**
 * Stops the repeating push loop. Called during graceful shutdown.
 */
export function stopRemoteWrite(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Prometheus remote write stopped');
  }
}
