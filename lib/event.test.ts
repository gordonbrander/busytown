import { assertEquals } from "@std/assert";
import { type Event, type ListenerDef, matchesListen } from "./event.ts";

const mkEvent = (type: string, worker_id = "w1"): Event => ({
  id: 1,
  timestamp: 0,
  type,
  worker_id,
  payload: {},
});

const mkListener = (id: string, listen: string[]): ListenerDef => ({
  id,
  listen,
});

// --- matchesListen ---

Deno.test("matchesListen - exact match", () => {
  const listener = mkListener("agent1", ["task.created"]);
  assertEquals(matchesListen(mkEvent("task.created"), listener), true);
  assertEquals(matchesListen(mkEvent("task.done"), listener), false);
});

Deno.test("matchesListen - prefix glob with .*", () => {
  const listener = mkListener("agent1", ["task.*"]);
  assertEquals(matchesListen(mkEvent("task.created"), listener), true);
  assertEquals(matchesListen(mkEvent("task.done"), listener), true);
  assertEquals(matchesListen(mkEvent("file.modified"), listener), false);
});

Deno.test("matchesListen - wildcard matches everything except self", () => {
  const listener = mkListener("agent1", ["*"]);
  assertEquals(matchesListen(mkEvent("task.created", "other"), listener), true);
  assertEquals(
    matchesListen(mkEvent("task.created", "agent1"), listener),
    false,
  );
});

Deno.test("matchesListen - multiple patterns", () => {
  const listener = mkListener("agent1", ["task.created", "file.*"]);
  assertEquals(matchesListen(mkEvent("task.created"), listener), true);
  assertEquals(matchesListen(mkEvent("file.modified"), listener), true);
  assertEquals(matchesListen(mkEvent("other.event"), listener), false);
});

Deno.test("matchesListen - empty listen array matches nothing", () => {
  const listener = mkListener("agent1", []);
  assertEquals(matchesListen(mkEvent("task.created"), listener), false);
});
