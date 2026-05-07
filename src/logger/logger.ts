import { getLogContext } from './context';
import { jsonFormatter, prettyFormatter, type LogEntry } from './formatters';
import { LOG_LEVELS, type LogLevel } from './levels';
import { stdoutTransport, type Transport } from './transports';

interface LoggerOptions {
  level: LogLevel;
  pretty: boolean;
  transports?: Transport[];
  name?: string;
}

/**
 * ValidDs custom structured logger.
 *
 * Designed to behave like Pino — structured JSON in production,
 * pretty-printed colour output in development — with zero external dependencies.
 *
 * Features:
 * - Numeric log levels with configurable minimum
 * - Automatic request context injection via AsyncLocalStorage
 * - JSON output (prod) and pretty output (dev)
 * - Error serialization with stack traces
 * - Child logger support (for adding static context to a sub-system)
 * - Pluggable transports
 */
export class Logger {
  private readonly minLevel: number;
  private readonly formatter: (entry: LogEntry) => string;
  private readonly transports: Transport[];
  private readonly staticContext: Record<string, unknown>;

  constructor(options: LoggerOptions, staticContext: Record<string, unknown> = {}) {
    this.minLevel = LOG_LEVELS[options.level] ?? LOG_LEVELS.info;
    this.formatter = options.pretty ? prettyFormatter : jsonFormatter;
    this.transports = options.transports ?? [stdoutTransport];
    this.staticContext = staticContext;
  }

  /**
   * Creates a child logger that inherits all settings
   * but adds fixed context fields to every log entry.
   *
   * Example:
   *   const log = logger.child({ module: 'ingestion' });
   *   log.info('job started');  // → { msg: 'job started', module: 'ingestion', ... }
   */
  child(context: Record<string, unknown>): Logger {
    return new Logger(
      {
        level: this._levelName(),
        pretty: this.formatter === prettyFormatter,
        transports: this.transports,
      },
      { ...this.staticContext, ...context }
    );
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    this._log(10, msg, data);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this._log(20, msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this._log(30, msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this._log(40, msg, data);
  }

  error(msg: string, err?: unknown, data?: Record<string, unknown>): void {
    this._log(50, msg, { ...data, err: serializeError(err) });
  }

  fatal(msg: string, err?: unknown, data?: Record<string, unknown>): void {
    this._log(60, msg, { ...data, err: serializeError(err) });
  }

  private _log(level: number, msg: string, data?: Record<string, unknown>): void {
    if (level < this.minLevel) return;

    const requestContext = getLogContext();

    const entry: LogEntry = {
      level,
      time: new Date().toISOString(),
      msg,
      ...this.staticContext,
      ...requestContext,
      ...data,
    };

    const line = this.formatter(entry);

    for (const transport of this.transports) {
      transport(line, level);
    }
  }

  private _levelName(): LogLevel {
    const entry = Object.entries(LOG_LEVELS).find(([, v]) => v === this.minLevel);
    return (entry?.[0] as LogLevel) ?? 'info';
  }
}

/**
 * Serialize an unknown thrown value into a plain object
 * so it can be safely JSON.stringified.
 */
function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    const anyErr = err as any;
    const isAxiosError = anyErr?.isAxiosError === true;

    return {
      type: err.name,
      message: err.message,
      stack: err.stack,
      ...(isAxiosError
        ? {
            axios: true,
            code: typeof anyErr.code === 'string' ? anyErr.code : undefined,
            status: typeof anyErr.response?.status === 'number' ? anyErr.response.status : undefined,
            method: typeof anyErr.config?.method === 'string' ? anyErr.config.method : undefined,
            url: typeof anyErr.config?.url === 'string' ? anyErr.config.url : undefined,
          }
        : {}),
      ...safeErrorExtras(anyErr),
    };
  }

  if (typeof err === 'object') {
    return {
      type: 'NonError',
      ...safeObject(err as Record<string, unknown>),
    };
  }

  return { raw: String(err) };
}

function safeErrorExtras(err: Record<string, unknown>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(err)) {
    if (['name', 'message', 'stack'].includes(key)) continue;
    if (value === null) {
      extras[key] = null;
      continue;
    }
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      extras[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      extras[key] = value
        .slice(0, 20)
        .map((v) => (v === null || ['string', 'number', 'boolean'].includes(typeof v) ? v : String(v)));
      continue;
    }
  }

  return extras;
}

function safeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) out[key] = null;
    else if (['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((v) => String(v));
    else out[key] = String(value);
  }
  return out;
}
