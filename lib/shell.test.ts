import { assertEquals } from "@std/assert";
import { shellEscape } from "./shell.ts";

Deno.test("shellEscape - wraps simple value in single quotes", () => {
  assertEquals(shellEscape("hello"), "'hello'");
});

Deno.test("shellEscape - escapes internal single quotes", () => {
  assertEquals(shellEscape("it's"), "'it'\\''s'");
});

Deno.test("shellEscape - preserves spaces", () => {
  assertEquals(shellEscape("hello world"), "'hello world'");
});

Deno.test("shellEscape - neutralizes dollar signs", () => {
  assertEquals(shellEscape("$HOME"), "'$HOME'");
});

Deno.test("shellEscape - neutralizes backticks", () => {
  assertEquals(shellEscape("`whoami`"), "'`whoami`'");
});

Deno.test("shellEscape - neutralizes semicolons and pipes", () => {
  assertEquals(shellEscape("a; rm -rf / | cat"), "'a; rm -rf / | cat'");
});

Deno.test("shellEscape - handles empty string", () => {
  assertEquals(shellEscape(""), "''");
});

Deno.test("shellEscape - handles multiple single quotes", () => {
  assertEquals(shellEscape("a'b'c"), "'a'\\''b'\\''c'");
});
