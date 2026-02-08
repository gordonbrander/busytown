import { assertEquals } from "@std/assert";
import {
  compileExcludes,
  DEFAULT_EXCLUDES,
  shouldExclude,
} from "./fs-watcher.ts";

// --- shouldExclude ---

const defaultCompiled = compileExcludes(DEFAULT_EXCLUDES);

Deno.test("shouldExclude - ignores .git subdirectories", () => {
  assertEquals(shouldExclude(".git/objects/abc123", defaultCompiled), true);
  assertEquals(shouldExclude(".git/HEAD", defaultCompiled), true);
  assertEquals(shouldExclude("some/path/.git/config", defaultCompiled), true);
});

Deno.test("shouldExclude - ignores node_modules", () => {
  assertEquals(
    shouldExclude("node_modules/foo/index.js", defaultCompiled),
    true,
  );
  assertEquals(shouldExclude("src/node_modules/bar.js", defaultCompiled), true);
});

Deno.test("shouldExclude - ignores .DS_Store", () => {
  assertEquals(shouldExclude(".DS_Store", defaultCompiled), true);
  assertEquals(shouldExclude("src/.DS_Store", defaultCompiled), true);
});

Deno.test("shouldExclude - ignores .pid files", () => {
  assertEquals(shouldExclude(".agent-runner.pid", defaultCompiled), true);
  assertEquals(shouldExclude("server.pid", defaultCompiled), true);
});

Deno.test("shouldExclude - ignores .log files", () => {
  assertEquals(shouldExclude(".agent-runner.log", defaultCompiled), true);
  assertEquals(shouldExclude("app.log", defaultCompiled), true);
  assertEquals(shouldExclude("error.log", defaultCompiled), true);
});

Deno.test("shouldExclude - ignores events.db and variants via glob", () => {
  assertEquals(shouldExclude("events.db", defaultCompiled), true);
  assertEquals(shouldExclude("events.db-shm", defaultCompiled), true);
  assertEquals(shouldExclude("events.db-wal", defaultCompiled), true);
});

Deno.test("shouldExclude - does not ignore normal source files", () => {
  assertEquals(shouldExclude("src/lib/foo.ts", defaultCompiled), false);
  assertEquals(shouldExclude("README.md", defaultCompiled), false);
  assertEquals(shouldExclude("agents/my-agent.md", defaultCompiled), false);
});

Deno.test("shouldExclude - does not ignore files starting with 'event' but not 'events.db'", () => {
  assertEquals(shouldExclude("event-handler.ts", defaultCompiled), false);
  assertEquals(shouldExclude("events.json", defaultCompiled), false);
});

Deno.test("shouldExclude - works with empty patterns", () => {
  const empty = compileExcludes([]);
  assertEquals(shouldExclude("src/foo.ts", empty), false);
  assertEquals(shouldExclude(".git/HEAD", empty), false);
});

Deno.test("shouldExclude - works with custom glob patterns", () => {
  const custom = compileExcludes(["**/dist/**", "**/build/**"]);
  assertEquals(shouldExclude("dist/bundle.js", custom), true);
  assertEquals(shouldExclude("build/output.js", custom), true);
  assertEquals(shouldExclude("src/index.ts", custom), false);
});

Deno.test("shouldExclude - glob patterns: test?.txt matches single char wildcard", () => {
  const custom = compileExcludes(["test?.txt"]);
  assertEquals(shouldExclude("test1.txt", custom), true);
  assertEquals(shouldExclude("testA.txt", custom), true);
  assertEquals(shouldExclude("test12.txt", custom), false);
  assertEquals(shouldExclude("test.txt", custom), false);
});

Deno.test("shouldExclude - DEFAULT_EXCLUDES contains expected entries", () => {
  assertEquals(DEFAULT_EXCLUDES.includes("**/.git/**"), true);
  assertEquals(DEFAULT_EXCLUDES.includes("**/node_modules/**"), true);
  assertEquals(DEFAULT_EXCLUDES.includes("**/.DS_Store"), true);
  assertEquals(DEFAULT_EXCLUDES.includes("*.pid"), true);
  assertEquals(DEFAULT_EXCLUDES.includes("*.log"), true);
  assertEquals(DEFAULT_EXCLUDES.includes("events.db*"), true);
});
