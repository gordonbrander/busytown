import { assertEquals, assertThrows } from "@std/assert";
import { openDb, pushEvent, getCursor } from "./event-queue.ts";
import { createWorkerSystem } from "./worker.ts";
import type { Event } from "./event.ts";

/** Opens a fresh in-memory database with all schemas initialized. */
const freshDb = () => openDb(":memory:");

/** Creates a promise that can be resolved externally. */
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// --- spawn ---

Deno.test("spawn - processes events from the queue", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  const received = deferred<Event>();

  system.spawn({
    id: "w1",
    next: async (event) => {
      received.resolve(event);
    },
  });

  pushEvent(db, "producer", "test.event", { hello: "world" });

  const event = await received.promise;
  assertEquals(event.type, "test.event");
  assertEquals(event.payload, { hello: "world" });

  await system.kill("w1");
  db.close();
});

Deno.test("spawn - throws if worker already exists", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  system.spawn({ id: "w1", next: async () => {} });

  assertThrows(
    () => system.spawn({ id: "w1", next: async () => {} }),
    Error,
    "Worker already exists: w1",
  );

  await system.kill("w1");
  db.close();
});

Deno.test("spawn - processes events in order", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  const received: string[] = [];
  const done = deferred();

  system.spawn({
    id: "w1",
    next: async (event) => {
      received.push(event.type);
      if (received.length === 3) done.resolve();
    },
  });

  pushEvent(db, "producer", "first");
  pushEvent(db, "producer", "second");
  pushEvent(db, "producer", "third");

  await done.promise;
  assertEquals(received, ["first", "second", "third"]);

  await system.kill("w1");
  db.close();
});

Deno.test("spawn - cursor advances to last processed event", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  const done = deferred();

  system.spawn({
    id: "w1",
    next: async (event) => {
      if (event.type === "b") done.resolve();
    },
  });

  // Events pushed after spawn have IDs > cursor
  pushEvent(db, "producer", "a");
  const { id: lastId } = pushEvent(db, "producer", "b");

  await done.promise;
  await system.kill("w1");

  assertEquals(getCursor(db, "w1"), lastId);
  db.close();
});

Deno.test("spawn - worker errors do not stop the loop", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  const done = deferred();

  system.spawn({
    id: "w1",
    next: async (event) => {
      if (event.type === "bad") throw new Error("boom");
      if (event.type === "good") done.resolve();
    },
  });

  pushEvent(db, "producer", "bad");
  pushEvent(db, "producer", "good");

  // Worker should recover from the error and process "good"
  await done.promise;
  await system.kill("w1");
  db.close();
});

// --- kill ---

Deno.test("kill - returns false for non-existent worker", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });

  assertEquals(await system.kill("nope"), false);
  db.close();
});

Deno.test("kill - awaits in-flight work before resolving", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  let handlerFinished = false;
  const handlerStarted = deferred();

  system.spawn({
    id: "w1",
    next: async (event) => {
      handlerStarted.resolve();
      // Simulate slow work
      await new Promise((r) => setTimeout(r, 50));
      handlerFinished = true;
    },
  });

  pushEvent(db, "producer", "slow.task");

  // Wait for the handler to start
  await handlerStarted.promise;

  // Kill should block until the handler finishes
  await system.kill("w1");
  assertEquals(handlerFinished, true);

  db.close();
});

Deno.test("kill - allows re-spawn with same id", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  const first = deferred();
  const second = deferred();

  system.spawn({
    id: "w1",
    next: async () => {
      first.resolve();
    },
  });

  pushEvent(db, "producer", "event1");
  await first.promise;
  await system.kill("w1");

  // Re-spawn with same id
  system.spawn({
    id: "w1",
    next: async () => {
      second.resolve();
    },
  });

  pushEvent(db, "producer", "event2");
  await second.promise;
  await system.kill("w1");

  db.close();
});

// --- multiple workers ---

Deno.test("multiple workers process independently", async () => {
  const db = freshDb();
  const system = createWorkerSystem({ db, timeout: 10 });
  const w1Events: string[] = [];
  const w2Events: string[] = [];
  const w1Done = deferred();
  const w2Done = deferred();

  system.spawn({
    id: "w1",
    next: async (event) => {
      if (event.type.startsWith("cursor.")) return;
      w1Events.push(event.type);
      if (w1Events.length === 2) w1Done.resolve();
    },
  });

  system.spawn({
    id: "w2",
    next: async (event) => {
      if (event.type.startsWith("cursor.")) return;
      w2Events.push(event.type);
      if (w2Events.length === 2) w2Done.resolve();
    },
  });

  pushEvent(db, "producer", "a");
  pushEvent(db, "producer", "b");

  await Promise.all([w1Done.promise, w2Done.promise]);

  // Both workers see both events
  assertEquals(w1Events, ["a", "b"]);
  assertEquals(w2Events, ["a", "b"]);

  await system.kill("w1");
  await system.kill("w2");
  db.close();
});
