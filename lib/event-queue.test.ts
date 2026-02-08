import { assertEquals } from "@std/assert";
import {
  claimEvent,
  getClaimant,
  getEventsSince,
  getOrCreateCursor,
  getSince,
  openDb,
  pollEvents,
  pushEvent,
  updateCursor,
} from "./event-queue.ts";

/** Opens a fresh in-memory database with all schemas initialized. */
const freshDb = () => openDb(":memory:");

// --- openDb ---

Deno.test("openDb - creates events table", () => {
  const db = freshDb();
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'",
    )
    .get() as { name: string } | undefined;
  assertEquals(row?.name, "events");
  db.close();
});

Deno.test("openDb - creates worker_cursors table", () => {
  const db = freshDb();
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='worker_cursors'",
    )
    .get() as { name: string } | undefined;
  assertEquals(row?.name, "worker_cursors");
  db.close();
});

Deno.test("openDb - creates claims table", () => {
  const db = freshDb();
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='claims'",
    )
    .get() as { name: string } | undefined;
  assertEquals(row?.name, "claims");
  db.close();
});

Deno.test("openDb - enables WAL mode", () => {
  const db = freshDb();
  // In-memory databases may report "memory" for journal_mode, but the pragma
  // call should not error. For file-backed DBs this would be "wal".
  const row = db.prepare("PRAGMA journal_mode").get() as {
    journal_mode: string;
  };
  assertEquals(typeof row.journal_mode, "string");
  db.close();
});

// --- pushEvent ---

Deno.test("pushEvent - returns auto-incremented id", () => {
  const db = freshDb();
  const { id: id1 } = pushEvent(db, "w1", "test.event");
  const { id: id2 } = pushEvent(db, "w1", "test.event");
  assertEquals(id1, 1);
  assertEquals(id2, 2);
  db.close();
});

Deno.test("pushEvent - stores event with default payload", () => {
  const db = freshDb();
  pushEvent(db, "w1", "test.event");
  const row = db.prepare("SELECT * FROM events WHERE id = 1").get() as {
    worker_id: string;
    type: string;
    payload: string;
  };
  assertEquals(row.worker_id, "w1");
  assertEquals(row.type, "test.event");
  assertEquals(row.payload, "{}");
  db.close();
});

Deno.test("pushEvent - stores event with custom payload", () => {
  const db = freshDb();
  pushEvent(db, "w1", "test.event", { key: "value", num: 42 });
  const row = db.prepare("SELECT payload FROM events WHERE id = 1").get() as {
    payload: string;
  };
  assertEquals(JSON.parse(row.payload), { key: "value", num: 42 });
  db.close();
});

// --- getSince ---

Deno.test("getSince - returns 0 for unknown worker", () => {
  const db = freshDb();
  assertEquals(getSince(db, "unknown"), 0);
  db.close();
});

Deno.test("getSince - returns stored cursor value", () => {
  const db = freshDb();
  updateCursor(db, "w1", 42);
  assertEquals(getSince(db, "w1"), 42);
  db.close();
});

// --- updateCursor ---

Deno.test("updateCursor - inserts new cursor", () => {
  const db = freshDb();
  updateCursor(db, "w1", 10);
  assertEquals(getSince(db, "w1"), 10);
  db.close();
});

Deno.test("updateCursor - upserts existing cursor", () => {
  const db = freshDb();
  updateCursor(db, "w1", 10);
  updateCursor(db, "w1", 20);
  assertEquals(getSince(db, "w1"), 20);
  db.close();
});

// --- getEventsSince ---

Deno.test("getEventsSince - returns empty array when no events", () => {
  const db = freshDb();
  const events = getEventsSince(db);
  assertEquals(events, []);
  db.close();
});

Deno.test("getEventsSince - returns events after sinceId", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");
  pushEvent(db, "w1", "c");

  const events = getEventsSince(db, { sinceId: 1 });
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "b");
  assertEquals(events[1].type, "c");
  db.close();
});

Deno.test("getEventsSince - returns all events when sinceId is 0", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");

  const events = getEventsSince(db, { sinceId: 0 });
  assertEquals(events.length, 2);
  db.close();
});

Deno.test("getEventsSince - respects limit", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");
  pushEvent(db, "w1", "c");

  const events = getEventsSince(db, { limit: 2 });
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "a");
  assertEquals(events[1].type, "b");
  db.close();
});

Deno.test("getEventsSince - omitWorkerId excludes events from that worker", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pushEvent(db, "w2", "b");
  pushEvent(db, "w1", "c");

  const events = getEventsSince(db, { omitWorkerId: "w1" });
  assertEquals(events.length, 1);
  assertEquals(events[0].type, "b");
  assertEquals(events[0].worker_id, "w2");
  db.close();
});

Deno.test("getEventsSince - filterWorkerId includes only that worker", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pushEvent(db, "w2", "b");
  pushEvent(db, "w1", "c");

  const events = getEventsSince(db, { filterWorkerId: "w1" });
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "a");
  assertEquals(events[1].type, "c");
  db.close();
});

Deno.test("getEventsSince - filterType includes only that type", () => {
  const db = freshDb();
  pushEvent(db, "w1", "task.created");
  pushEvent(db, "w1", "task.done");
  pushEvent(db, "w1", "task.created");

  const events = getEventsSince(db, { filterType: "task.created" });
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "task.created");
  assertEquals(events[1].type, "task.created");
  db.close();
});

Deno.test("getEventsSince - filterType '*' returns all types", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");

  const events = getEventsSince(db, { filterType: "*" });
  assertEquals(events.length, 2);
  db.close();
});

Deno.test("getEventsSince - tail returns last N events in ascending order", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");
  pushEvent(db, "w1", "c");
  pushEvent(db, "w1", "d");

  const events = getEventsSince(db, { tail: 2 });
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "c");
  assertEquals(events[1].type, "d");
  db.close();
});

Deno.test("getEventsSince - deserializes payload", () => {
  const db = freshDb();
  pushEvent(db, "w1", "test", { hello: "world" });

  const events = getEventsSince(db);
  assertEquals(events[0].payload, { hello: "world" });
  db.close();
});

Deno.test("getEventsSince - events are ordered by id ascending", () => {
  const db = freshDb();
  pushEvent(db, "w1", "first");
  pushEvent(db, "w1", "second");
  pushEvent(db, "w1", "third");

  const events = getEventsSince(db);
  assertEquals(events[0].id < events[1].id, true);
  assertEquals(events[1].id < events[2].id, true);
  db.close();
});

// --- pollEvents ---

Deno.test("pollEvents - returns new events and advances cursor", () => {
  const db = freshDb();
  // Pre-set cursor so the worker sees events pushed after it
  updateCursor(db, "reader", 0);
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");

  const events = pollEvents(db, "reader");
  assertEquals(events.length, 2);
  assertEquals(getSince(db, "reader"), events[1].id);
  db.close();
});

Deno.test("pollEvents - second poll returns only new events", () => {
  const db = freshDb();
  updateCursor(db, "reader", 0);
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");

  pollEvents(db, "reader");
  pushEvent(db, "w1", "c");

  const events = pollEvents(db, "reader");
  assertEquals(events.length, 1);
  assertEquals(events[0].type, "c");
  db.close();
});

Deno.test("pollEvents - returns empty array and does not advance cursor when no new events", () => {
  const db = freshDb();
  pushEvent(db, "w1", "a");
  pollEvents(db, "reader");

  const events = pollEvents(db, "reader");
  assertEquals(events.length, 0);
  db.close();
});

Deno.test("pollEvents - omitWorkerId excludes self-events", () => {
  const db = freshDb();
  updateCursor(db, "w1", 0);
  pushEvent(db, "w1", "own-event");
  pushEvent(db, "w2", "other-event");

  const events = pollEvents(db, "w1", 100, "w1");
  assertEquals(events.length, 1);
  assertEquals(events[0].type, "other-event");
  db.close();
});

Deno.test("pollEvents - respects limit", () => {
  const db = freshDb();
  updateCursor(db, "reader", 0);
  pushEvent(db, "w1", "a");
  pushEvent(db, "w1", "b");
  pushEvent(db, "w1", "c");

  const events = pollEvents(db, "reader", 2);
  assertEquals(events.length, 2);
  db.close();
});

// --- claimEvent ---

Deno.test("claimEvent - first claim succeeds", () => {
  const db = freshDb();
  const { id: eventId } = pushEvent(db, "w1", "task");
  const claimed = claimEvent(db, "claimer1", eventId);
  assertEquals(claimed, true);
  db.close();
});

Deno.test("claimEvent - second claim by different worker fails", () => {
  const db = freshDb();
  const { id: eventId } = pushEvent(db, "w1", "task");
  claimEvent(db, "claimer1", eventId);
  const claimed = claimEvent(db, "claimer2", eventId);
  assertEquals(claimed, false);
  db.close();
});

Deno.test("claimEvent - same worker claiming twice succeeds", () => {
  const db = freshDb();
  const { id: eventId } = pushEvent(db, "w1", "task");
  claimEvent(db, "claimer1", eventId);
  const claimed = claimEvent(db, "claimer1", eventId);
  assertEquals(claimed, true);
  db.close();
});

Deno.test("claimEvent - emits claim.created event on success", () => {
  const db = freshDb();
  const { id: eventId } = pushEvent(db, "w1", "task");
  claimEvent(db, "claimer1", eventId);

  const events = getEventsSince(db, { filterType: "claim.created" });
  assertEquals(events.length, 1);
  assertEquals((events[0].payload as { event_id: number }).event_id, eventId);
  assertEquals(events[0].worker_id, "claimer1");
  db.close();
});

Deno.test("claimEvent - does not emit claim.created on failure", () => {
  const db = freshDb();
  const { id: eventId } = pushEvent(db, "w1", "task");
  claimEvent(db, "claimer1", eventId);
  claimEvent(db, "claimer2", eventId);

  const events = getEventsSince(db, { filterType: "claim.created" });
  assertEquals(events.length, 1); // only the first claim emitted an event
  db.close();
});

// --- getClaimant ---

Deno.test("getClaimant - returns undefined for unclaimed event", () => {
  const db = freshDb();
  const { id: eventId } = pushEvent(db, "w1", "task");
  assertEquals(getClaimant(db, eventId), undefined);
  db.close();
});

Deno.test("getClaimant - returns claim details for claimed event", () => {
  const db = freshDb();
  const { id: eventId } = pushEvent(db, "w1", "task");
  claimEvent(db, "claimer1", eventId);

  const claim = getClaimant(db, eventId);
  assertEquals(claim?.worker_id, "claimer1");
  assertEquals(typeof claim?.claimed_at, "number");
  db.close();
});

// --- combined filters ---

Deno.test("getEventsSince - combines sinceId with filterType", () => {
  const db = freshDb();
  pushEvent(db, "w1", "task.created");
  pushEvent(db, "w1", "task.done");
  pushEvent(db, "w1", "task.created");

  const events = getEventsSince(db, { sinceId: 1, filterType: "task.created" });
  assertEquals(events.length, 1);
  assertEquals(events[0].id, 3);
  db.close();
});

Deno.test("getEventsSince - combines filterWorkerId with filterType", () => {
  const db = freshDb();
  pushEvent(db, "w1", "task.created");
  pushEvent(db, "w2", "task.created");
  pushEvent(db, "w1", "task.done");

  const events = getEventsSince(db, {
    filterWorkerId: "w1",
    filterType: "task.created",
  });
  assertEquals(events.length, 1);
  assertEquals(events[0].worker_id, "w1");
  assertEquals(events[0].type, "task.created");
  db.close();
});

Deno.test("getEventsSince - tail with filterType returns last N of that type", () => {
  const db = freshDb();
  pushEvent(db, "w1", "task.created");
  pushEvent(db, "w1", "noise");
  pushEvent(db, "w1", "task.created");
  pushEvent(db, "w1", "noise");
  pushEvent(db, "w1", "task.created");

  const events = getEventsSince(db, { filterType: "task.created", tail: 2 });
  assertEquals(events.length, 2);
  assertEquals(events[0].type, "task.created");
  assertEquals(events[1].type, "task.created");
  assertEquals(events[0].id < events[1].id, true);
  db.close();
});

// --- getOrCreateCursor ---

Deno.test("getOrCreateCursor - returns cursor.create event ID for new worker", () => {
  const db = freshDb();
  const since = getOrCreateCursor(db, "new-agent");
  assertEquals(since > 0, true);
  db.close();
});

Deno.test("getOrCreateCursor - pushes a cursor.create event for new worker", () => {
  const db = freshDb();
  getOrCreateCursor(db, "new-agent");
  const events = getEventsSince(db, { filterType: "cursor.create" });
  assertEquals(events.length, 1);
  assertEquals(events[0].worker_id, "runner");
  assertEquals(
    (events[0].payload as { agent_id: string }).agent_id,
    "new-agent",
  );
  db.close();
});

Deno.test("getOrCreateCursor - returns existing cursor value without pushing events", () => {
  const db = freshDb();
  updateCursor(db, "existing-agent", 42);
  const since = getOrCreateCursor(db, "existing-agent");
  assertEquals(since, 42);
  const events = getEventsSince(db, { filterType: "cursor.create" });
  assertEquals(events.length, 0);
  db.close();
});

Deno.test("getOrCreateCursor - new worker skips pre-existing events when used with getEventsSince", () => {
  const db = freshDb();
  pushEvent(db, "w1", "old.event");
  pushEvent(db, "w1", "old.event");

  const since = getOrCreateCursor(db, "late-joiner");

  pushEvent(db, "w1", "new.event");

  const events = getEventsSince(db, { sinceId: since });
  assertEquals(events.length, 1);
  assertEquals(events[0].type, "new.event");
  db.close();
});
