import { assertEquals } from "@std/assert";
import { toSlug } from "./slug.ts";

// --- sanitizeId ---

Deno.test("sanitizeId - lowercase passthrough", () => {
  assertEquals(toSlug("review"), "review");
});

Deno.test("sanitizeId - already kebab-case is unchanged", () => {
  assertEquals(toSlug("idea-collider"), "idea-collider");
});

Deno.test("sanitizeId - spaces become hyphens", () => {
  assertEquals(toSlug("my agent"), "my-agent");
});

Deno.test("sanitizeId - multiple spaces collapse to single hyphen", () => {
  assertEquals(toSlug("my   agent"), "my-agent");
});

Deno.test("sanitizeId - special characters are stripped", () => {
  assertEquals(toSlug("my@agent!"), "myagent");
});

Deno.test("sanitizeId - dots are stripped", () => {
  assertEquals(toSlug("my.agent"), "myagent");
});

Deno.test("sanitizeId - underscores are preserved", () => {
  assertEquals(toSlug("my_agent"), "my_agent");
});

Deno.test("sanitizeId - leading and trailing spaces are trimmed", () => {
  assertEquals(toSlug("  agent  "), "agent");
});

Deno.test("sanitizeId - uppercase is lowercased", () => {
  assertEquals(toSlug("AGENT"), "agent");
});

Deno.test("sanitizeId - numbers are preserved", () => {
  assertEquals(toSlug("agent123"), "agent123");
});

Deno.test("sanitizeId - empty string returns undefined", () => {
  assertEquals(toSlug(""), undefined);
});

Deno.test("sanitizeId - all special chars returns undefined", () => {
  assertEquals(toSlug("@#$%"), undefined);
});

Deno.test("sanitizeId - mixed camelCase with hyphens", () => {
  assertEquals(toSlug("myAgent-worker"), "myagent-worker");
});

Deno.test("sanitizeId - tabs and newlines become hyphens", () => {
  assertEquals(toSlug("my\tagent\nworker"), "my-agent-worker");
});
