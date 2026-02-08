import { assertEquals } from "@std/assert";
import {
  create,
  fileJsonDriver,
  type LogDriver,
  type LogEntry,
  Logger,
  multiDriver,
} from "./logger.ts";

/** Creates a mock driver that captures log entries */
const createMockDriver = (): LogDriver & { entries: LogEntry[] } => {
  const entries: LogEntry[] = [];
  return {
    entries,
    debug: (entry) => entries.push(entry),
    info: (entry) => entries.push(entry),
    warn: (entry) => entries.push(entry),
    error: (entry) => entries.push(entry),
  };
};

Deno.test("Logger - logs at default info level", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver });

  logger.debug("debug message");
  logger.info("info message");
  logger.warn("warn message");
  logger.error("error message");

  assertEquals(driver.entries.length, 4);
  assertEquals(driver.entries[0].msg, "debug message");
  assertEquals(driver.entries[1].msg, "info message");
  assertEquals(driver.entries[2].msg, "warn message");
  assertEquals(driver.entries[3].msg, "error message");
});

Deno.test("Logger - respects debug level", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver, level: "debug" });

  logger.debug("debug message");
  logger.info("info message");

  assertEquals(driver.entries.length, 2);
  assertEquals(driver.entries[0].msg, "debug message");
  assertEquals(driver.entries[1].msg, "info message");
});

Deno.test("Logger - respects warn level", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver, level: "warn" });

  logger.debug("debug message");
  logger.info("info message");
  logger.warn("warn message");
  logger.error("error message");

  assertEquals(driver.entries.length, 2);
  assertEquals(driver.entries[0].msg, "warn message");
  assertEquals(driver.entries[1].msg, "error message");
});

Deno.test("Logger - respects error level", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver, level: "error" });

  logger.debug("debug message");
  logger.info("info message");
  logger.warn("warn message");
  logger.error("error message");

  assertEquals(driver.entries.length, 1);
  assertEquals(driver.entries[0].msg, "error message");
});

Deno.test("Logger - includes context in log entries", () => {
  const driver = createMockDriver();
  const logger = new Logger({ service: "test-service" }, { driver });

  logger.info("test message");

  assertEquals(driver.entries[0].service, "test-service");
  assertEquals(driver.entries[0].msg, "test message");
});

Deno.test("Logger - includes additional data in log entries", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver });

  logger.info("test message", { userId: 123, action: "login" });

  assertEquals(driver.entries[0].userId, 123);
  assertEquals(driver.entries[0].action, "login");
});

Deno.test("Logger - data overrides context with same key", () => {
  const driver = createMockDriver();
  const logger = new Logger({ key: "context-value" }, { driver });

  logger.info("test message", { key: "data-value" });

  assertEquals(driver.entries[0].key, "data-value");
});

Deno.test("Logger - includes timestamp in log entries", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver });
  const before = Date.now();

  logger.info("test message");

  const after = Date.now();
  const time = driver.entries[0].time as number;
  assertEquals(time >= before && time <= after, true);
});

Deno.test("Logger.child - creates child logger with merged context", () => {
  const driver = createMockDriver();
  const parent = new Logger({ service: "parent" }, { driver });
  const child = parent.child({ component: "child" });

  child.info("child message");

  assertEquals(driver.entries[0].service, "parent");
  assertEquals(driver.entries[0].component, "child");
});

Deno.test("Logger.child - inherits driver and level from parent", () => {
  const driver = createMockDriver();
  const parent = new Logger({}, { driver, level: "warn" });
  const child = parent.child({ component: "child" });

  child.info("should not log");
  child.warn("should log");

  assertEquals(driver.entries.length, 1);
  assertEquals(driver.entries[0].msg, "should log");
});

Deno.test("Logger.child - child context overrides parent context", () => {
  const driver = createMockDriver();
  const parent = new Logger({ key: "parent-value" }, { driver });
  const child = parent.child({ key: "child-value" });

  child.info("test message");

  assertEquals(driver.entries[0].key, "child-value");
});

Deno.test("Logger.child - does not affect parent logger", () => {
  const driver = createMockDriver();
  const parent = new Logger({ service: "parent" }, { driver });
  parent.child({ component: "child" });

  parent.info("parent message");

  assertEquals(driver.entries[0].service, "parent");
  assertEquals(driver.entries[0].component, undefined);
});

Deno.test("create - factory function creates logger with context", () => {
  const driver = createMockDriver();
  const logger = create({ service: "factory-test" }, { driver });

  logger.info("test message");

  assertEquals(driver.entries[0].service, "factory-test");
});

Deno.test("create - factory function with no arguments creates default logger", () => {
  const driver = createMockDriver();
  const logger = create({}, { driver });

  logger.info("test message");

  assertEquals(driver.entries[0].msg, "test message");
});

// --- level field tests ---

Deno.test("Logger - includes level field in log entries", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver });

  logger.debug("d");
  logger.info("i");
  logger.warn("w");
  logger.error("e");

  assertEquals(driver.entries[0].level, "debug");
  assertEquals(driver.entries[1].level, "info");
  assertEquals(driver.entries[2].level, "warn");
  assertEquals(driver.entries[3].level, "error");
});

// --- fileJsonDriver tests ---

Deno.test({
  name: "fileJsonDriver - creates parent dir and writes NDJSON lines",
  sanitizeResources: false,
  fn() {
    const tmpDir = Deno.makeTempDirSync();
    const logPath = `${tmpDir}/subdir/test.log`;
    const driver = fileJsonDriver(logPath);
    const logger = new Logger({}, { driver });

    logger.info("first line");
    logger.warn("second line");

    const content = Deno.readTextFileSync(logPath);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 2);

    const entry1 = JSON.parse(lines[0]);
    assertEquals(entry1.msg, "first line");
    assertEquals(entry1.level, "info");

    const entry2 = JSON.parse(lines[1]);
    assertEquals(entry2.msg, "second line");
    assertEquals(entry2.level, "warn");

    Deno.removeSync(tmpDir, { recursive: true });
  },
});

Deno.test({
  name: "fileJsonDriver - appends to existing file",
  sanitizeResources: false,
  fn() {
    const tmpDir = Deno.makeTempDirSync();
    const logPath = `${tmpDir}/test.log`;

    // Write first batch
    const driver1 = fileJsonDriver(logPath);
    new Logger({}, { driver: driver1 }).info("batch 1");

    // Write second batch with new driver instance
    const driver2 = fileJsonDriver(logPath);
    new Logger({}, { driver: driver2 }).info("batch 2");

    const content = Deno.readTextFileSync(logPath);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 2);
    assertEquals(JSON.parse(lines[0]).msg, "batch 1");
    assertEquals(JSON.parse(lines[1]).msg, "batch 2");

    Deno.removeSync(tmpDir, { recursive: true });
  },
});

// --- multiDriver tests ---

Deno.test("multiDriver - fans out to all drivers", () => {
  const driver1 = createMockDriver();
  const driver2 = createMockDriver();
  const multi = multiDriver(driver1, driver2);
  const logger = new Logger({}, { driver: multi });

  logger.info("hello");
  logger.error("oops");

  assertEquals(driver1.entries.length, 2);
  assertEquals(driver2.entries.length, 2);
  assertEquals(driver1.entries[0].msg, "hello");
  assertEquals(driver2.entries[0].msg, "hello");
  assertEquals(driver1.entries[1].msg, "oops");
  assertEquals(driver2.entries[1].msg, "oops");
});
