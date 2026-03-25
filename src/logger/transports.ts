import * as fs from 'fs';
import * as path from 'path';

export type Transport = (line: string, level: number) => void;

/**
 * Stdout transport — writes every log line to process.stdout.
 * Used in all environments. Render/cloud platforms capture stdout automatically.
 */
export const stdoutTransport: Transport = (line) => {
  process.stdout.write(line + '\n');
};

/**
 * File transport — appends log lines to a rotating daily log file.
 * Only active when LOG_FILE_PATH is set in env.
 * Keep off in production cloud deployments (use stdout → log aggregator instead).
 */
export function createFileTransport(logDir: string): Transport {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return (line: string) => {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(logDir, `${date}.log`);
    fs.appendFile(filePath, line + '\n', (err) => {
      if (err) process.stderr.write(`[Logger] File write error: ${err.message}\n`);
    });
  };
}

/**
 * Sentry transport — forwards error/fatal logs to Sentry.
 * Sentry is initialised separately in src/monitoring/sentry.ts.
 * This transport calls into it when a log entry carries an Error object.
 */
export function createSentryTransport(): Transport {
  return (_line: string, level: number) => {
    // Only forward error (50) and fatal (60) to Sentry.
    // Actual Sentry.captureException is called in the logger core
    // when err is present — this transport is a no-op stub kept
    // here for extensibility (e.g. webhooks, Slack alerts).
    if (level >= 50) {
      // Extended in monitoring/alerts.ts for non-error alerting
    }
  };
}
