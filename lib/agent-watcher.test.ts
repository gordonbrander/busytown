import { assertEquals } from "@std/assert";
import { collapseKind } from "./agent-watcher.ts";

// --- collapseKind ---

Deno.test("collapseKind - single remove is remove", () => {
  assertEquals(collapseKind(new Set(["remove"])), "remove");
});

Deno.test("collapseKind - single modify is modify", () => {
  assertEquals(collapseKind(new Set(["modify"])), "modify");
});

Deno.test("collapseKind - single create is create", () => {
  assertEquals(collapseKind(new Set(["create"])), "create");
});

Deno.test("collapseKind - create + modify is create", () => {
  assertEquals(collapseKind(new Set(["create", "modify"])), "create");
});

Deno.test("collapseKind - remove + create is create (vim write pattern)", () => {
  assertEquals(collapseKind(new Set(["remove", "create"])), "create");
});

Deno.test("collapseKind - remove + modify is modify", () => {
  assertEquals(collapseKind(new Set(["remove", "modify"])), "modify");
});

Deno.test("collapseKind - rename alone is modify", () => {
  assertEquals(collapseKind(new Set(["rename"])), "modify");
});

Deno.test("collapseKind - remove + create + modify is create", () => {
  assertEquals(collapseKind(new Set(["remove", "create", "modify"])), "create");
});
