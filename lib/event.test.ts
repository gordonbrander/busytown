import { assertEquals } from "@std/assert";
import { type Event, eventMatches } from "./event.ts";

const mkEvent = (type: string, worker_id = "w1"): Event => ({
  id: 1,
  timestamp: 0,
  type,
  worker_id,
  payload: {},
});

// --- eventMatches ---

Deno.test("eventMatches - exact match", () => {
  assertEquals(eventMatches(mkEvent("task.created"), ["task.created"]), true);
  assertEquals(eventMatches(mkEvent("task.done"), ["task.created"]), false);
});

Deno.test("eventMatches - prefix glob with .*", () => {
  assertEquals(eventMatches(mkEvent("task.created"), ["task.*"]), true);
  assertEquals(eventMatches(mkEvent("task.done"), ["task.*"]), true);
  assertEquals(eventMatches(mkEvent("file.modified"), ["task.*"]), false);
});

Deno.test("eventMatches - wildcard matches everything", () => {
  assertEquals(eventMatches(mkEvent("task.created", "other"), ["*"]), true);
  assertEquals(
    eventMatches(mkEvent("task.created", "agent1"), ["*"]),
    true,
  );
});

Deno.test("eventMatches - multiple patterns", () => {
  assertEquals(
    eventMatches(mkEvent("task.created"), ["task.created", "file.*"]),
    true,
  );
  assertEquals(
    eventMatches(mkEvent("file.modified"), ["task.created", "file.*"]),
    true,
  );
  assertEquals(
    eventMatches(mkEvent("other.event"), ["task.created", "file.*"]),
    false,
  );
});

Deno.test("eventMatches - empty listen array matches nothing", () => {
  assertEquals(eventMatches(mkEvent("task.created"), []), false);
});
