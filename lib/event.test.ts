import { assertEquals } from "@std/assert";
import {
  type Event,
  filterMatchedEvents,
  type ListenerDef,
  matchesListen,
} from "./event.ts";

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
  assertEquals(matchesListen(mkEvent("task.created", "agent1"), listener), false);
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

// --- filterMatchedEvents ---

Deno.test("filterMatchedEvents - returns only matching events", () => {
  const listener = mkListener("agent1", ["task.*"]);
  const events = [
    mkEvent("task.created"),
    mkEvent("file.modified"),
    mkEvent("task.done"),
  ];
  const result = filterMatchedEvents(events, listener);
  assertEquals(result.length, 2);
  assertEquals(result[0].type, "task.created");
  assertEquals(result[1].type, "task.done");
});

Deno.test("filterMatchedEvents - returns empty array when nothing matches", () => {
  const listener = mkListener("agent1", ["task.*"]);
  const events = [mkEvent("file.modified"), mkEvent("other.event")];
  assertEquals(filterMatchedEvents(events, listener), []);
});

Deno.test("filterMatchedEvents - wildcard excludes self-events", () => {
  const listener = mkListener("agent1", ["*"]);
  const events = [
    mkEvent("task.created", "agent1"),
    mkEvent("task.created", "agent2"),
    mkEvent("file.modified", "agent1"),
  ];
  const result = filterMatchedEvents(events, listener);
  assertEquals(result.length, 1);
  assertEquals(result[0].worker_id, "agent2");
});
