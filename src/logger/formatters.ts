import { BOLD, DIM, LEVEL_COLOURS, LEVEL_LABELS, RESET } from './levels';

export interface LogEntry {
  level: number;
  time: string;
  msg: string;
  requestId?: string;
  userId?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  err?: unknown;
  [key: string]: unknown;
}

/**
 * JSON formatter — used in staging/production.
 * Outputs a single-line JSON object per log entry.
 * Structured for easy ingestion by log aggregators (Datadog, Loki, CloudWatch).
 */
export function jsonFormatter(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Pretty formatter — used in development.
 * Human-readable, colour-coded output to stdout.
 *
 * Format: [HH:MM:SS] LEVEL  msg  {context}
 */
export function prettyFormatter(entry: LogEntry): string {
  const { level, time, msg, err, requestId, ...rest } = entry;

  const colour = LEVEL_COLOURS[level] ?? '';
  const label = (LEVEL_LABELS[level] ?? 'UNKNOWN').padEnd(5);
  const timestamp = new Date(time).toTimeString().slice(0, 8);

  let line = `${DIM}[${timestamp}]${RESET} ${colour}${BOLD}${label}${RESET}  ${msg}`;

  // Append request ID if present
  if (requestId) {
    line += `  ${DIM}rid=${requestId}${RESET}`;
  }

  // Append any extra context fields
  const extras = Object.keys(rest).filter(
    (k) => !['userId', 'route', 'statusCode', 'durationMs'].includes(k)
  );
  if (extras.length > 0) {
    const extraStr = extras.map((k) => `${k}=${JSON.stringify(rest[k])}`).join(' ');
    line += `  ${DIM}${extraStr}${RESET}`;
  }

  // Format error with stack trace
  if (err) {
    if (err instanceof Error) {
      line += `\n  ${colour}${err.name}: ${err.message}${RESET}`;
      if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1);
        line += '\n' + stackLines.map((l) => `    ${DIM}${l.trim()}${RESET}`).join('\n');
      }
    } else {
      line += `\n  ${colour}${JSON.stringify(err)}${RESET}`;
    }
  }

  return line;
}
