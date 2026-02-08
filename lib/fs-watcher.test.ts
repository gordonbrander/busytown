import { assertEquals } from "@std/assert";
import {
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_IGNORE_PREFIXES,
  shouldIgnore,
} from "./fs-watcher.ts";

// --- shouldIgnore ---

Deno.test("shouldIgnore - ignores .git subdirectories", () => {
  assertEquals(shouldIgnore(".git/objects/abc123"), true);
  assertEquals(shouldIgnore(".git/HEAD"), true);
  assertEquals(shouldIgnore("some/path/.git/config"), true);
});

Deno.test("shouldIgnore - ignores .git root entry", () => {
  assertEquals(shouldIgnore(".git"), true);
});

Deno.test("shouldIgnore - ignores node_modules", () => {
  assertEquals(shouldIgnore("node_modules/foo/index.js"), true);
  assertEquals(shouldIgnore("src/node_modules/bar.js"), true);
});

Deno.test("shouldIgnore - ignores .DS_Store", () => {
  assertEquals(shouldIgnore(".DS_Store"), true);
  assertEquals(shouldIgnore("src/.DS_Store"), true);
});

Deno.test("shouldIgnore - ignores .agent-runner.pid", () => {
  assertEquals(shouldIgnore(".agent-runner.pid"), true);
});

Deno.test("shouldIgnore - ignores .agent-runner.log", () => {
  assertEquals(shouldIgnore(".agent-runner.log"), true);
});

Deno.test("shouldIgnore - ignores events.db by prefix match", () => {
  assertEquals(shouldIgnore("events.db"), true);
  assertEquals(shouldIgnore("events.db-shm"), true);
  assertEquals(shouldIgnore("events.db-wal"), true);
});

Deno.test("shouldIgnore - does not ignore normal source files", () => {
  assertEquals(shouldIgnore("src/lib/foo.ts"), false);
  assertEquals(shouldIgnore("README.md"), false);
  assertEquals(shouldIgnore("agents/my-agent.md"), false);
});

Deno.test("shouldIgnore - does not ignore files starting with 'event' but not 'events.db'", () => {
  assertEquals(shouldIgnore("event-handler.ts"), false);
  assertEquals(shouldIgnore("events.json"), false);
});

Deno.test("shouldIgnore - works with empty patterns", () => {
  assertEquals(shouldIgnore("src/foo.ts", [], []), false);
  assertEquals(shouldIgnore(".git/HEAD", [], []), false);
});

Deno.test("shouldIgnore - works with custom patterns", () => {
  assertEquals(shouldIgnore("dist/bundle.js", ["dist"], []), true);
  assertEquals(shouldIgnore("build/output.js", ["build"], []), true);
  assertEquals(shouldIgnore("src/index.ts", ["dist", "build"], []), false);
});

Deno.test("shouldIgnore - works with custom prefixes", () => {
  assertEquals(shouldIgnore("test.log", [], ["test.log"]), true);
  assertEquals(shouldIgnore("test.log.1", [], ["test.log"]), true);
  assertEquals(shouldIgnore("other.log", [], ["test.log"]), false);
});

Deno.test("shouldIgnore - default patterns match expected values", () => {
  assertEquals(DEFAULT_IGNORE_PATTERNS.includes(".git"), true);
  assertEquals(DEFAULT_IGNORE_PATTERNS.includes("node_modules"), true);
  assertEquals(DEFAULT_IGNORE_PATTERNS.includes(".DS_Store"), true);
  assertEquals(DEFAULT_IGNORE_PATTERNS.includes(".agent-runner.pid"), true);
  assertEquals(DEFAULT_IGNORE_PATTERNS.includes(".agent-runner.log"), true);
  assertEquals(DEFAULT_IGNORE_PREFIXES.includes("events.db"), true);
});
