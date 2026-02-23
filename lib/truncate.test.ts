import { assertEquals } from "@std/assert";
import { truncate, truncatePath } from "./truncate.ts";

Deno.test("truncate - returns string unchanged when within limit", () => {
  assertEquals(truncate("hello", 10), "hello");
});

Deno.test("truncate - returns string unchanged when exactly at limit", () => {
  assertEquals(truncate("hello", 5), "hello");
});

Deno.test("truncate - truncates with ellipsis when over limit", () => {
  assertEquals(truncate("hello world", 6), "hello…");
});

Deno.test("truncate - handles maxLen of 1", () => {
  assertEquals(truncate("hello", 1), "…");
});

Deno.test("truncate - handles empty string", () => {
  assertEquals(truncate("", 5), "");
});

Deno.test("truncatePath - returns path unchanged when within limit", () => {
  assertEquals(truncatePath("src/foo.ts", 20), "src/foo.ts");
});

Deno.test("truncatePath - returns path unchanged when exactly at limit", () => {
  assertEquals(truncatePath("src/foo.ts", 10), "src/foo.ts");
});

Deno.test("truncatePath - truncates with …/ prefix keeping tail", () => {
  assertEquals(truncatePath("src/lib/utils/foo.ts", 12), "…/ils/foo.ts");
});

Deno.test("truncatePath - returns …/ when remaining is zero", () => {
  assertEquals(truncatePath("src/foo.ts", 2), "…/");
});

Deno.test("truncatePath - handles short maxLen", () => {
  assertEquals(truncatePath("a/b/c/d.ts", 5), "…/.ts");
});
