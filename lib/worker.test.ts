import { assertEquals } from "@std/assert";
import { openDb, pushEvent } from "./event-queue.ts";
import { type Event } from "./event.ts";
import { createSystem, worker } from "./worker.ts";

/** Opens a fresh in-memory database with all schemas initialized. */
const freshDb = () => openDb(":memory:");

/**
 * Creates a deferred promise that can be resolved externally.
 * Useful for waiting on fire-and-forget effects in tests.
 */
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// --- worker() helper ---

Deno.test("worker - wraps a sync run function as async", async () => {
  const db = freshDb();
  const received = deferred<Event>();

  const w = worker({
    id: "test",
    listen: ["task.*"],
    run: (event) => {
      received.resolve(event);
    },
  });

  const system = createSystem(db, 10);
  system.spawn(w);
  pushEvent(db, "pusher", "task.created", { n: 1 });

  const event = await received.promise;
  assertEquals(event.type, "task.created");
  assertEquals(event.payload, { n: 1 });

  await system.stop();
  db.close();
});

// --- spawn ---

Deno.test("spawn - returns the worker id", () => {
  const db = freshDb();
  const system = createSystem(db, 10);

  const w = worker({ id: "w1", listen: ["*"], run: () => {} });
  const id = system.spawn(w);
  assertEquals(id, "w1");

  system.stop();
  db.close();
});

Deno.test("spawn - throws on duplicate worker id", async () => {
  const db = freshDb();
  const system = createSystem(db, 10);

  const w = worker({ id: "w1", listen: ["*"], run: () => {} });
  system.spawn(w);

  let threw = false;
  try {
    system.spawn(w);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);

  await system.stop();
  db.close();
});

// --- event delivery ---

Deno.test("worker receives matching events", async () => {
  const db = freshDb();
  const received = deferred<Event>();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.created"],
      run: (event) => {
        received.resolve(event);
      },
    }),
  );

  pushEvent(db, "pusher", "task.created", { hello: "world" });

  const event = await received.promise;
  assertEquals(event.type, "task.created");
  assertEquals(event.payload, { hello: "world" });

  await system.stop();
  db.close();
});

Deno.test("worker ignores non-matching events", async () => {
  const db = freshDb();
  const calls: Event[] = [];
  const matched = deferred();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: (event) => {
        calls.push(event);
        matched.resolve();
      },
    }),
  );

  // Push a non-matching event, then a matching one.
  pushEvent(db, "pusher", "file.changed");
  pushEvent(db, "pusher", "task.done");

  await matched.promise;
  // Only the matching event should have been delivered.
  assertEquals(calls.length, 1);
  assertEquals(calls[0].type, "task.done");

  await system.stop();
  db.close();
});

Deno.test("worker receives multiple events in order", async () => {
  const db = freshDb();
  const calls: Event[] = [];
  const done = deferred();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: (event) => {
        calls.push(event);
        if (calls.length === 3) done.resolve();
      },
    }),
  );

  pushEvent(db, "pusher", "task.a");
  pushEvent(db, "pusher", "task.b");
  pushEvent(db, "pusher", "task.c");

  await done.promise;
  assertEquals(calls.map((e) => e.type), ["task.a", "task.b", "task.c"]);

  await system.stop();
  db.close();
});

// --- serial processing ---

Deno.test("worker processes events serially", async () => {
  const db = freshDb();
  const timeline: string[] = [];
  const done = deferred();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: async (event) => {
        timeline.push(`start:${event.type}`);
        await new Promise((r) => setTimeout(r, 50));
        timeline.push(`end:${event.type}`);
        if (event.type === "task.b") done.resolve();
      },
    }),
  );

  pushEvent(db, "pusher", "task.a");
  pushEvent(db, "pusher", "task.b");

  await done.promise;
  // Serial: first effect must complete before second starts.
  assertEquals(timeline, [
    "start:task.a",
    "end:task.a",
    "start:task.b",
    "end:task.b",
  ]);

  await system.stop();
  db.close();
});

// --- multiple workers receive the same event ---

Deno.test("multiple workers each receive the same event", async () => {
  const db = freshDb();
  const received1 = deferred<Event>();
  const received2 = deferred<Event>();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: (event) => received1.resolve(event),
    }),
  );
  system.spawn(
    worker({
      id: "w2",
      listen: ["task.*"],
      run: (event) => received2.resolve(event),
    }),
  );

  pushEvent(db, "pusher", "task.created");

  const [e1, e2] = await Promise.all([received1.promise, received2.promise]);
  assertEquals(e1.type, "task.created");
  assertEquals(e2.type, "task.created");

  await system.stop();
  db.close();
});

// --- at-most-once delivery ---

Deno.test("at-most-once: failing effect does not redeliver", async () => {
  const db = freshDb();
  let callCount = 0;
  const called = deferred();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: () => {
        callCount++;
        called.resolve();
        throw new Error("effect failed");
      },
    }),
  );

  pushEvent(db, "pusher", "task.created");
  await called.promise;

  // Give the polling loop a few cycles to ensure no redelivery.
  await new Promise((r) => setTimeout(r, 50));
  assertEquals(callCount, 1);

  await system.stop();
  db.close();
});

// --- kill ---

Deno.test("kill - returns true for existing worker", async () => {
  const db = freshDb();
  const system = createSystem(db, 10);
  system.spawn(worker({ id: "w1", listen: ["*"], run: () => {} }));

  const result = await system.kill("w1");
  assertEquals(result, true);

  await system.stop();
  db.close();
});

Deno.test("kill - returns false for nonexistent worker", async () => {
  const db = freshDb();
  const system = createSystem(db, 10);

  const result = await system.kill("nope");
  assertEquals(result, false);

  await system.stop();
  db.close();
});

Deno.test("kill - stopped worker no longer receives events", async () => {
  const db = freshDb();
  let callCount = 0;

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: () => {
        callCount++;
      },
    }),
  );

  await system.kill("w1");

  // Push events after kill — worker should not receive them.
  pushEvent(db, "pusher", "task.created");
  await new Promise((r) => setTimeout(r, 50));
  assertEquals(callCount, 0);

  await system.stop();
  db.close();
});

// --- abort signal ---

Deno.test("effect receives abort signal that aborts on kill", async () => {
  const db = freshDb();
  const gotSignal = deferred<AbortSignal>();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: (_event, ctx) => {
        gotSignal.resolve(ctx.abortSignal);
      },
    }),
  );

  pushEvent(db, "pusher", "task.created");
  const signal = await gotSignal.promise;
  assertEquals(signal.aborted, false);

  await system.kill("w1");
  assertEquals(signal.aborted, true);

  await system.stop();
  db.close();
});

Deno.test("effect receives abort signal that aborts on stop", async () => {
  const db = freshDb();
  const gotSignal = deferred<AbortSignal>();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: (_event, ctx) => {
        gotSignal.resolve(ctx.abortSignal);
      },
    }),
  );

  pushEvent(db, "pusher", "task.created");
  const signal = await gotSignal.promise;
  assertEquals(signal.aborted, false);

  await system.stop();
  assertEquals(signal.aborted, true);

  db.close();
});

// --- stop ---

Deno.test("stop - waits for in-flight effects to settle", async () => {
  const db = freshDb();
  let effectFinished = false;
  const effectStarted = deferred();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: async () => {
        effectStarted.resolve();
        await new Promise((r) => setTimeout(r, 50));
        effectFinished = true;
      },
    }),
  );

  pushEvent(db, "pusher", "task.created");
  await effectStarted.promise;

  await system.stop();
  assertEquals(effectFinished, true);

  db.close();
});

Deno.test("stop - can be called with no workers", async () => {
  const db = freshDb();
  const system = createSystem(db, 10);
  await system.stop();
  db.close();
});

// --- ignoreSelf ---

Deno.test("ignoreSelf - worker ignores events it emitted", async () => {
  const db = freshDb();
  const calls: Event[] = [];
  const received = deferred();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      run: (event) => {
        calls.push(event);
        received.resolve();
      },
    }),
  );

  // Event emitted by w1 itself — should be ignored (ignoreSelf defaults to true)
  pushEvent(db, "w1", "task.created", { self: true });
  // Event emitted by another worker — should be delivered
  pushEvent(db, "other", "task.created", { self: false });

  await received.promise;
  assertEquals(calls.length, 1);
  assertEquals(calls[0].worker_id, "other");

  await system.stop();
  db.close();
});

Deno.test("ignoreSelf false - worker sees its own events", async () => {
  const db = freshDb();
  const received = deferred<Event>();

  const system = createSystem(db, 10);
  system.spawn(
    worker({
      id: "w1",
      listen: ["task.*"],
      ignoreSelf: false,
      run: (event) => {
        received.resolve(event);
      },
    }),
  );

  pushEvent(db, "w1", "task.created", { self: true });

  const event = await received.promise;
  assertEquals(event.worker_id, "w1");
  assertEquals(event.payload, { self: true });

  await system.stop();
  db.close();
});
