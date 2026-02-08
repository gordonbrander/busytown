import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

/** Get the log level index. This lets us decide which log levels to log. */
const logLevelToIndex = (level: LogLevel): number => {
  switch (level) {
    case "debug":
      return 0;
    case "info":
      return 1;
    case "warn":
      return 2;
    case "error":
      return 3;
    default:
      throw new Error(`Invalid log level: ${level}`);
  }
};

export type LogEntry = Record<string, unknown> & { msg: string };

export type LogDriver = {
  /** Log a debug message */
  debug: (entry: LogEntry) => void;
  /** Log an info message */
  info: (entry: LogEntry) => void;
  /** Log a warning message */
  warn: (entry: LogEntry) => void;
  /** Log an error message */
  error: (entry: LogEntry) => void;
};

export type LoggerOptions = {
  driver?: LogDriver;
  level?: LogLevel;
};

/** A log driver that logs to the console in JSON format */
export const consoleJsonDriver = (): LogDriver => ({
  debug: (entry) => console.debug(JSON.stringify(entry)),
  info: (entry) => console.info(JSON.stringify(entry)),
  warn: (entry) => console.warn(JSON.stringify(entry)),
  error: (entry) => console.error(JSON.stringify(entry)),
});

/** A log driver that logs to the console in a pretty format */
export const consolePrettyDriver = (): LogDriver => ({
  debug: (entry) => console.debug(entry.msg, entry),
  info: (entry) => console.info(entry.msg, entry),
  warn: (entry) => console.warn(entry.msg, entry),
  error: (entry) => console.error(entry.msg, entry),
});

const textEncoder = new TextEncoder();

/** A log driver that writes NDJSON to a file */
export const fileJsonDriver = (filePath: string): LogDriver => {
  const dir = dirname(filePath);
  Deno.mkdirSync(dir, { recursive: true });
  const file = Deno.openSync(filePath, {
    write: true,
    create: true,
    append: true,
  });
  const write = (entry: LogEntry) => {
    file.writeSync(textEncoder.encode(JSON.stringify(entry) + "\n"));
  };
  return {
    debug: write,
    info: write,
    warn: write,
    error: write,
  };
};

/** A log driver that fans out each log call to multiple drivers */
export const multiDriver = (...drivers: LogDriver[]): LogDriver => ({
  debug: (entry) => {
    for (const d of drivers) {
      d.debug(entry);
    }
  },
  info: (entry) => {
    for (const d of drivers) {
      d.info(entry);
    }
  },
  warn: (entry) => {
    for (const d of drivers) {
      d.warn(entry);
    }
  },
  error: (entry) => {
    for (const d of drivers) {
      d.error(entry);
    }
  },
});

const prepareLogObject = (
  context: Record<string, unknown>,
  data: Record<string, unknown>,
  level: LogLevel,
  msg: string,
): LogEntry => ({
  ...context,
  ...data,
  level,
  time: Date.now(),
  msg,
});

export class Logger {
  context: LogContext;
  driver: LogDriver;
  level: LogLevel;

  constructor(context: LogContext = {}, options: LoggerOptions = {}) {
    this.context = context;
    this.driver = options.driver ?? consoleJsonDriver();
    this.level = options.level ?? "debug";
  }

  /** Create a child logger with additional context */
  child(context: LogContext): Logger {
    return new Logger(
      { ...this.context, ...context },
      { driver: this.driver, level: this.level },
    );
  }

  #shouldLog = (level: LogLevel): boolean => {
    return logLevelToIndex(level) >= logLevelToIndex(this.level);
  };

  /** Log a debug message */
  debug(msg: string, data: LogContext = {}): void {
    if (this.#shouldLog("debug")) {
      this.driver.debug(prepareLogObject(this.context, data, "debug", msg));
    }
  }

  /** Log an info message */
  info(msg: string, data: LogContext = {}): void {
    if (this.#shouldLog("info")) {
      this.driver.info(prepareLogObject(this.context, data, "info", msg));
    }
  }

  /** Log a warning message */
  warn(msg: string, data: LogContext = {}): void {
    if (this.#shouldLog("warn")) {
      this.driver.warn(prepareLogObject(this.context, data, "warn", msg));
    }
  }

  /** Log an error message */
  error(msg: string, data: LogContext = {}): void {
    if (this.#shouldLog("error")) {
      this.driver.error(prepareLogObject(this.context, data, "error", msg));
    }
  }
}

/** Factory function for backward compatibility */
export const create = (
  context: LogContext = {},
  options: LoggerOptions = {},
): Logger => new Logger(context, options);
