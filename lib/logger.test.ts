import { assertEquals } from "@std/assert";
import { create, type LogDriver, type LogEntry, Logger } from "./logger.ts";

/** Creates a mock driver that captures log entries */
const createMockDriver = (): LogDriver & { entries: LogEntry[] } => {
  const entries: LogEntry[] = [];
  return {
    entries,
    debug: (entry) => entries.push({ ...entry, level: "debug" }),
    info: (entry) => entries.push({ ...entry, level: "info" }),
    warn: (entry) => entries.push({ ...entry, level: "warn" }),
    error: (entry) => entries.push({ ...entry, level: "error" }),
  };
};

Deno.test("Logger - logs at default info level", () => {
  const driver = createMockDriver();
  const logger = new Logger({}, { driver });

  logger.debug("debug message");
  logger.info("info message");
  logger.warn("warn message");
  logger.error("error message");

  assertEquals(driver.entries.length, 3);
  assertEquals(driver.entries[0].msg, "info message");
  assertEquals(driver.entries[1].msg, "warn message");
  assertEquals(driver.entries[2].msg, "error message");
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
