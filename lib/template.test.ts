import { assertEquals } from "@std/assert";
import { renderTemplate, resolvePath } from "./template.ts";

// --- resolvePath ---

Deno.test("resolvePath - resolves top-level key", () => {
  assertEquals(resolvePath({ name: "alice" }, "name"), "alice");
});

Deno.test("resolvePath - resolves nested dot path", () => {
  assertEquals(resolvePath({ a: { b: { c: 42 } } }, "a.b.c"), 42);
});

Deno.test("resolvePath - returns undefined for missing top-level key", () => {
  assertEquals(resolvePath({}, "missing"), undefined);
});

Deno.test("resolvePath - returns undefined for missing intermediate key", () => {
  assertEquals(resolvePath({ a: {} }, "a.b.c"), undefined);
});

Deno.test("resolvePath - returns undefined when traversing through a primitive", () => {
  assertEquals(resolvePath({ a: "string" }, "a.b"), undefined);
});

Deno.test("resolvePath - returns undefined when traversing through null", () => {
  assertEquals(resolvePath({ a: null }, "a.b"), undefined);
});

Deno.test("resolvePath - resolves falsy values without short-circuiting", () => {
  assertEquals(resolvePath({ a: 0 }, "a"), 0);
  assertEquals(resolvePath({ a: false }, "a"), false);
  assertEquals(resolvePath({ a: "" }, "a"), "");
});

// --- renderTemplate ---

Deno.test("renderTemplate - basic key replacement with shell escaping", () => {
  const result = renderTemplate("echo {{name}}", { name: "hello" });
  assertEquals(result, "echo 'hello'");
});

Deno.test("renderTemplate - deep path lookup", () => {
  const result = renderTemplate("echo {{a.b.c}}", { a: { b: { c: "deep" } } });
  assertEquals(result, "echo 'deep'");
});

Deno.test("renderTemplate - triple-brace raw replacement", () => {
  const result = renderTemplate("echo {{{name}}}", { name: "hello world" });
  assertEquals(result, "echo hello world");
});

Deno.test("renderTemplate - missing keys resolve to empty string", () => {
  const result = renderTemplate("echo {{missing}}", {});
  assertEquals(result, "echo ");
});

Deno.test("renderTemplate - missing deep path resolves to empty string", () => {
  const result = renderTemplate("echo {{a.b.c}}", { a: {} });
  assertEquals(result, "echo ");
});

Deno.test("renderTemplate - shell metacharacters are escaped", () => {
  const result = renderTemplate("echo {{val}}", {
    val: "hello; rm -rf / && `whoami` $HOME",
  });
  assertEquals(result, "echo 'hello; rm -rf / && `whoami` $HOME'");
});

Deno.test("renderTemplate - single quotes in value are escaped", () => {
  const result = renderTemplate("echo {{val}}", { val: "it's a test" });
  assertEquals(result, "echo 'it'\\''s a test'");
});

Deno.test("renderTemplate - mixed escaped and unescaped placeholders", () => {
  const result = renderTemplate(
    "cd {{{dir}}} && echo {{msg}}",
    { dir: "/tmp/my dir", msg: "hello world" },
  );
  assertEquals(result, "cd /tmp/my dir && echo 'hello world'");
});

Deno.test("renderTemplate - triple-brace is not double-matched", () => {
  const result = renderTemplate("{{{val}}}", { val: "raw" });
  assertEquals(result, "raw");
});

Deno.test("renderTemplate - numeric value is stringified", () => {
  const result = renderTemplate("echo {{count}}", { count: 42 });
  assertEquals(result, "echo '42'");
});
