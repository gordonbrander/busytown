export type Logger = {
  info: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
};

/** Type-safe way to reference console loggers by key dynamically */
type LogLevel = "info" | "debug" | "warn" | "error";

const makeJsonLogger = (
  level: LogLevel,
  context: Record<string, unknown> = {},
) =>
(msg: string, data: Record<string, unknown> = {}): void => {
  console[level](JSON.stringify({
    ...data,
    ...context,
    timestamp: Date.now(),
    msg,
  }));
};

/** Create a simple JSON logger that logs to the console */
export const create = (context: Record<string, unknown> = {}): Logger => {
  return {
    debug: makeJsonLogger("debug", context),
    info: makeJsonLogger("info", context),
    warn: makeJsonLogger("warn", context),
    error: makeJsonLogger("error", context),
  };
};
