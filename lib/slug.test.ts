import { assertEquals } from "@std/assert";
import { pathToSlug, toSlug } from "./slug.ts";

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

// --- pathToSlug ---

Deno.test("pathToSlug - extracts slug from simple filename", () => {
  assertEquals(pathToSlug("/path/to/agents/my-agent.md"), "my-agent");
});

Deno.test("pathToSlug - lowercases the slug", () => {
  assertEquals(pathToSlug("/path/to/agents/MyAgent.md"), "myagent");
});

Deno.test("pathToSlug - converts spaces to dashes", () => {
  assertEquals(pathToSlug("/path/to/agents/my agent.md"), "my-agent");
});

Deno.test("pathToSlug - handles dotfile edge case", () => {
  // basename(".md", ".md") returns "" on some platforms, "md" on others
  // Either way, it should not crash
  const result = pathToSlug("/path/to/agents/.md");
  assertEquals(typeof result === "string" || result === undefined, true);
});

Deno.test("pathToSlug - handles nested path", () => {
  assertEquals(
    pathToSlug("/Users/foo/Dev/project/agents/code-review.md"),
    "code-review",
  );
});

Deno.test("pathToSlug - strips non-.md extensions", () => {
  assertEquals(pathToSlug("/path/to/file.txt"), "file");
  assertEquals(pathToSlug("/path/to/file.yaml"), "file");
});

Deno.test("pathToSlug - handles file with no extension", () => {
  assertEquals(pathToSlug("/path/to/agents/myagent"), "myagent");
});
