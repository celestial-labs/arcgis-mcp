/**
 * Minimal leveled logger.
 *
 * IMPORTANT: When the server speaks over the stdio transport, `stdout` is the
 * MCP protocol channel. All human-readable logging therefore MUST go to
 * `stderr`, otherwise it corrupts the JSON-RPC stream.
 */

export type LogLevel = "debug" | "info" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  error: 30,
};

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

function write(level: LogLevel, message: string, context?: unknown): void {
  const line =
    context === undefined
      ? `[${level}] ${message}`
      : `[${level}] ${message} ${safeStringify(context)}`;
  // Always stderr — never stdout (reserved for the MCP protocol).
  process.stderr.write(`${line}\n`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVEL_RANK[level];
  const enabled = (candidate: LogLevel): boolean => LEVEL_RANK[candidate] >= threshold;

  return {
    debug(message, context) {
      if (enabled("debug")) write("debug", message, context);
    },
    info(message, context) {
      if (enabled("info")) write("info", message, context);
    },
    error(message, context) {
      if (enabled("error")) write("error", message, context);
    },
  };
}
