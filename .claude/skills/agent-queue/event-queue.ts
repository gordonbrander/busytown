#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * SQLite-backed event queue for inter-worker communication.
 *
 * Provides a simple pub/sub mechanism where workers can push events and poll
 * for new events using cursor-based pagination. Each worker maintains its own
 * cursor position, enabling reliable at-least-once delivery.
 *
 * @module event-queue
 */

import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { die, requireOpt, sleep } from "./utils.ts";

/**
 * Opens a SQLite database and initializes the event queue schema.
 *
 * Enables WAL mode for better concurrent access and creates the `events`
 * and `worker_cursors` tables if they don't exist.
 *
 * @param path - Path to the SQLite database file
 * @returns The opened database connection
 */
export const openDb = (path: string): DatabaseSync => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA user_version = 1");

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      type TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_cursors (
      worker_id TEXT PRIMARY KEY,
      since INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  return db;
};

/**
 * A parsed event with deserialized payload.
 *
 * @property id - Unique auto-incrementing event ID
 * @property timestamp - Unix epoch timestamp when the event was created
 * @property type - Event type identifier (e.g., "task.created", "message.sent")
 * @property worker_id - ID of the worker that pushed this event
 * @property payload - Deserialized JSON payload data
 */
export type Event = {
  id: number;
  timestamp: number;
  type: string;
  worker_id: string;
  payload: unknown;
};

/**
 * Raw database row before JSON payload deserialization.
 */
export type RawEventRow = Omit<Event, "payload"> & { payload: string };

/**
 * Inserts a new event into the queue.
 *
 * @param db - Database connection
 * @param workerId - ID of the worker pushing the event
 * @param type - Event type identifier
 * @param payload - Optional JSON-serializable payload data
 * @returns The auto-generated event ID
 */
export const pushEvent = (
  db: DatabaseSync,
  workerId: string,
  type: string,
  payload: unknown = {},
): number => {
  const stmt = db.prepare(
    "INSERT INTO events (worker_id, type, payload) VALUES (?, ?, ?) RETURNING id",
  );
  const row = stmt.get(workerId, type, JSON.stringify(payload)) as {
    id: number;
  };
  return row.id;
};

/**
 * Gets the current cursor position for a worker.
 *
 * @param db - Database connection
 * @param workerId - Worker ID to look up
 * @returns The last processed event ID, or 0 if no cursor exists
 */
export const getSince = (db: DatabaseSync, workerId: string): number => {
  const stmt = db.prepare(
    "SELECT since FROM worker_cursors WHERE worker_id = ?",
  );
  const row = stmt.get(workerId) as { since: number } | undefined;
  return row?.since ?? 0;
};

/**
 * Fetches events after a given event ID.
 *
 * @param db - Database connection
 * @param sinceId - Return events with ID greater than this value
 * @param limit - Maximum number of events to return (default: 100)
 * @param omitWorkerId - Optional worker ID to exclude from results
 * @returns Array of events ordered by ID ascending
 */
export const getEventsSince = (
  db: DatabaseSync,
  sinceId: number,
  limit = 100,
  omitWorkerId?: string,
): Event[] => {
  const sql = omitWorkerId
    ? "SELECT * FROM events WHERE id > ? AND worker_id != ? ORDER BY id ASC LIMIT ?"
    : "SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?";
  const stmt = db.prepare(sql);
  const rows =
    (omitWorkerId
      ? stmt.all(sinceId, omitWorkerId, limit)
      : stmt.all(sinceId, limit)) as RawEventRow[];
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
};

/**
 * Polls for new events and automatically advances the worker's cursor.
 *
 * Combines {@link getSince}, {@link getEventsSince}, and {@link updateCursor}
 * into a single operation for convenient event consumption.
 *
 * @param db - Database connection
 * @param workerId - Worker ID to poll as (determines cursor position)
 * @param limit - Maximum number of events to return (default: 100)
 * @param omitWorkerId - Optional worker ID to exclude from results
 * @returns Array of new events; cursor is advanced to the last event's ID
 */
export const pollEvents = (
  db: DatabaseSync,
  workerId: string,
  limit = 100,
  omitWorkerId?: string,
): Event[] => {
  const since = getSince(db, workerId);
  const events = getEventsSince(db, since, limit, omitWorkerId);
  if (events.length > 0) {
    updateCursor(db, workerId, events[events.length - 1].id);
  }
  return events;
};

/**
 * Sets or updates a worker's cursor position.
 *
 * Uses upsert semantics: creates the cursor if it doesn't exist,
 * otherwise updates the existing cursor.
 *
 * @param db - Database connection
 * @param workerId - Worker ID to update
 * @param sinceId - New cursor position (last processed event ID)
 */
export const updateCursor = (
  db: DatabaseSync,
  workerId: string,
  sinceId: number,
): void => {
  const stmt = db.prepare(
    "INSERT INTO worker_cursors (worker_id, since, timestamp) VALUES (?, ?, unixepoch()) ON CONFLICT(worker_id) DO UPDATE SET since = excluded.since, timestamp = excluded.timestamp",
  );
  stmt.run(workerId, sinceId);
};

// --- CLI ---

const USAGE = `Usage: event-queue <command> [options]

Commands:
  watch    Poll for new events and stream ndjson to stdout.
           --worker <id> [--poll <seconds>] [--omit_worker_id <id>]

  push     Push an event. Reads { type, payload } from --data or stdin.
           --worker <id> [--data <json>]

  since    Get the cursor for a worker.
           --worker <id>

  events   Get events after a given id.
           --since <id> [--limit <n>] [--omit_worker_id <id>]

  cursor   Set the cursor for a worker.
           --worker <id> --set <event_id>

Global options:
  --db <path>   Database path (default: events.db)
  --help        Show this help`;

/** Reads JSON input from stdin, returns "{}" if empty. */
const readStdin = async (): Promise<string> => {
  const buf = new Uint8Array(1024 * 1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return "{}";
  return new TextDecoder().decode(buf.subarray(0, n)).trim() || "{}";
};

/** CLI entrypoint: parses args and dispatches to subcommands. */
const cli = async () => {
  const { values, positionals } = parseArgs({
    args: Deno.args,
    options: {
      db: { type: "string", default: "events.db" },
      worker: { type: "string", short: "w" },
      data: { type: "string", short: "d" },
      since: { type: "string", short: "s" },
      set: { type: "string" },
      omit_worker: { type: "string" },
      poll: { type: "string", default: "3" },
      limit: { type: "string", short: "l" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    Deno.exit(0);
  }

  const command = positionals[0];
  const db = openDb(values.db!);

  try {
    switch (command) {
      case "watch": {
        const worker = requireOpt(values.worker, "worker");
        const intervalMs = parseFloat(values.poll!) * 1000;
        const encoder = new TextEncoder();
        const write = (s: string) => Deno.stdout.writeSync(encoder.encode(s));

        while (true) {
          const events = pollEvents(db, worker, 100, values.omit_worker);
          for (const event of events) {
            write(JSON.stringify(event) + "\n");
          }
          await sleep(intervalMs);
        }
      }

      case "push": {
        const worker = requireOpt(values.worker, "worker");
        const raw = values.data ?? await readStdin();
        const { type, payload = {} } = JSON.parse(raw) as {
          type?: string;
          payload?: unknown;
        };
        if (type == undefined) {
          return die('Input must include a "type" field');
        }
        const id = pushEvent(db, worker, type, payload);
        console.log(JSON.stringify({ id }));
        return;
      }

      case "since": {
        const worker = requireOpt(values.worker, "worker");
        const since = getSince(db, worker);
        console.log(JSON.stringify({ worker_id: worker, since }));
        return;
      }

      case "events": {
        const sinceId = parseInt(requireOpt(values.since, "since"), 10);
        const limit = values.limit ? parseInt(values.limit, 10) : 100;
        const events = getEventsSince(
          db,
          sinceId,
          limit,
          values.omit_worker,
        );
        for (const event of events) {
          console.log(JSON.stringify(event));
        }
        return;
      }

      case "cursor": {
        const worker = requireOpt(values.worker, "worker");
        const sinceId = parseInt(requireOpt(values.set, "set"), 10);
        updateCursor(db, worker, sinceId);
        console.log(JSON.stringify({ worker_id: worker, since: sinceId }));
        return;
      }

      default:
        return die(`Unknown command: ${command}\n\n${USAGE}`);
    }
  } finally {
    db.close();
  }
};

if (import.meta.main) {
  await cli();
}
