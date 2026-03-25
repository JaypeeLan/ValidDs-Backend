/**
 * Log level definitions.
 *
 * Each level has a numeric priority — higher number = more severe.
 * Only messages at or above the configured LOG_LEVEL are emitted.
 *
 * trace  (10) — very granular internal events (dev only)
 * debug  (20) — useful dev/diagnostic info
 * info   (30) — normal operational events
 * warn   (40) — something unexpected but non-fatal
 * error  (50) — an error occurred; needs attention
 * fatal  (60) — system is about to crash
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

// ANSI colour codes for pretty output
export const LEVEL_COLOURS: Record<number, string> = {
  10: '\x1b[90m',  // grey
  20: '\x1b[36m',  // cyan
  30: '\x1b[32m',  // green
  40: '\x1b[33m',  // yellow
  50: '\x1b[31m',  // red
  60: '\x1b[35m',  // magenta
};

export const RESET = '\x1b[0m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
