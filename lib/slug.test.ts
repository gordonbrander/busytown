import { assertEquals } from "@std/assert";
import { toSlug } from "./slug.ts";

// --- toSlug ---

Deno.test("toSlug - lowercase passthrough", () => {
  assertEquals(toSlug("review"), "review");
});

Deno.test("toSlug - already kebab-case is unchanged", () => {
  assertEquals(toSlug("idea-collider"), "idea-collider");
});

Deno.test("toSlug - spaces become hyphens", () => {
  assertEquals(toSlug("my agent"), "my-agent");
});

Deno.test("toSlug - multiple spaces collapse to single hyphen", () => {
  assertEquals(toSlug("my   agent"), "my-agent");
});

Deno.test("toSlug - special characters are stripped", () => {
  assertEquals(toSlug("my@agent!"), "myagent");
});

Deno.test("toSlug - dots are stripped", () => {
  assertEquals(toSlug("my.agent"), "myagent");
});

Deno.test("toSlug - underscores are preserved", () => {
  assertEquals(toSlug("my_agent"), "my_agent");
});

Deno.test("toSlug - leading and trailing spaces are trimmed", () => {
  assertEquals(toSlug("  agent  "), "agent");
});

Deno.test("toSlug - uppercase is lowercased", () => {
  assertEquals(toSlug("AGENT"), "agent");
});

Deno.test("toSlug - numbers are preserved", () => {
  assertEquals(toSlug("agent123"), "agent123");
});

Deno.test("toSlug - empty string returns undefined", () => {
  assertEquals(toSlug(""), undefined);
});

Deno.test("toSlug - all special chars returns undefined", () => {
  assertEquals(toSlug("@#$%"), undefined);
});

Deno.test("toSlug - mixed camelCase with hyphens", () => {
  assertEquals(toSlug("myAgent-worker"), "myagent-worker");
});

Deno.test("toSlug - tabs and newlines become hyphens", () => {
  assertEquals(toSlug("my\tagent\nworker"), "my-agent-worker");
});
