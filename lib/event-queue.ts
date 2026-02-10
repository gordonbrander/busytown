/**
 * SQLite-backed event queue for inter-worker communication.
 *
 * Provides a simple pub/sub mechanism where workers can push events and poll
 * for new events using cursor-based pagination. Each worker maintains its own
 * cursor position, enabling reliable at-least-once delivery.
 *
 * Also handles database initialization: opens SQLite with WAL mode and creates
 * all schemas (events, worker_cursors, claims).
 *
 * @module event-queue
 */

import { z } from "zod/v4";
import { DatabaseSync } from "node:sqlite";
import type { Event, RawEventRow } from "./event.ts";
import mainLogger from "./main-logger.ts";

const logger = mainLogger.child({ component: "event-queue" });

// Local Zod schemas for ad-hoc row shapes returned by SQL queries
const InsertReturningRowSchema = z.object({
  id: z.number(),
  timestamp: z.number(),
});

const CursorRowSchema = z.object({ since: z.number() });

const ClaimWorkerRowSchema = z.object({ worker_id: z.string() });

const ClaimDetailRowSchema = z.object({
  worker_id: z.string(),
  claimed_at: z.number(),
});

type InsertReturningRow = z.infer<typeof InsertReturningRowSchema>;
type CursorRow = z.infer<typeof CursorRowSchema>;
type ClaimWorkerRow = z.infer<typeof ClaimWorkerRowSchema>;
type ClaimDetailRow = z.infer<typeof ClaimDetailRowSchema>;

/**
 * Opens a SQLite database and initializes all schemas.
 *
 * Enables WAL mode, busy timeout, and foreign keys, then creates the
 * `events`, `worker_cursors`, and `claims` tables if they don't exist.
 *
 * @param path - Path to the SQLite database file
 * @returns The opened database connection
 */
export const openDb = (path: string): DatabaseSync => {
  logger.info("Opening database", { db: path });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  // Events schema
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

  // Claims schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      event_id INTEGER PRIMARY KEY,
      worker_id TEXT NOT NULL,
      claimed_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  return db;
};

/** Run a function inside a BEGIN/COMMIT transaction with ROLLBACK on error. */
const transaction = <T>(db: DatabaseSync, fn: () => T): T => {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

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
): Event => {
  const stmt = db.prepare(
    "INSERT INTO events (worker_id, type, payload) VALUES (?, ?, ?) RETURNING id, timestamp",
  );

  const { id, timestamp } = stmt.get(
    workerId,
    type,
    JSON.stringify(payload),
  ) as InsertReturningRow;

  const event = {
    id,
    type,
    worker_id: workerId,
    payload,
    timestamp,
  };

  logger.info("Event pushed", { event });
  return event;
};

/**
 * Gets the current cursor position for a worker.
 *
 * @param db - Database connection
 * @param workerId - Worker ID to look up
 * @returns The last processed event ID, or 0 if no cursor exists
 */
export const getCursor = (db: DatabaseSync, workerId: string): number => {
  const stmt = db.prepare(
    "SELECT since FROM worker_cursors WHERE worker_id = ?",
  );
  const row = stmt.get(workerId) as CursorRow | undefined;
  return row?.since ?? 0;
};

/**
 * Options for {@link getEventsSince}.
 */
export type GetEventsOptions = {
  /** Return events with ID greater than this value */
  sinceId?: number;
  /** Maximum number of events for forward scan (default: 100) */
  limit?: number;
  /** Worker ID to exclude from results */
  omitWorkerId?: string;
  /** Worker ID to include exclusively */
  filterWorkerId?: string;
  /** Event type to filter by ("*" or undefined means all) */
  filterType?: string;
  /** When set, return the last N matching events (ordered ascending) */
  tail?: number;
};

/**
 * Fetches events after a given event ID.
 *
 * @param db - Database connection
 * @param opts - Query options
 * @returns Array of events ordered by ID ascending
 */
export const getEventsSince = (
  db: DatabaseSync,
  { sinceId = 0, limit = 100, omitWorkerId, filterWorkerId, filterType, tail }:
    GetEventsOptions = {},
): Event[] => {
  let sql = "SELECT * FROM events WHERE id > ?";
  const params: (number | string)[] = [sinceId];
  if (omitWorkerId) {
    sql += " AND worker_id != ?";
    params.push(omitWorkerId);
  }
  if (filterWorkerId) {
    sql += " AND worker_id = ?";
    params.push(filterWorkerId);
  }
  if (filterType && filterType !== "*") {
    sql += " AND type = ?";
    params.push(filterType);
  }
  if (tail) {
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(tail);
  } else {
    sql += " ORDER BY id ASC LIMIT ?";
    params.push(limit);
  }
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as RawEventRow[];
  const events = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  return tail ? events.reverse() : events;
};

/**
 * Polls for new events and automatically advances the worker's cursor.
 *
 * Combines {@link getCursor}, {@link getEventsSince}, and {@link updateCursor}
 * into a single operation for convenient event consumption.
 *
 * @param db - Database connection
 * @param workerId - Worker ID to poll as (determines cursor position)
 * @param limit - Maximum number of events to return (default: 100)
 * @param omitWorkerId - Optional worker ID to exclude from results
 * @returns Array of new events; cursor is advanced to the last event's ID
 */
export const pollEventLog = (
  db: DatabaseSync,
  workerId: string,
  limit = 100,
  omitWorkerId?: string,
): Event[] => {
  const since = getOrCreateCursor(db, workerId);
  const events = getEventsSince(db, { sinceId: since, limit, omitWorkerId });
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

/**
 * Gets or creates a cursor for a worker.
 *
 * If the worker already has a cursor, returns its current position.
 * Otherwise, pushes a `cursor.create` event, sets the cursor to that
 * event's ID, and returns it — so the new worker starts from the current
 * tail rather than replaying all history.
 *
 * @param db - Database connection
 * @param workerId - Worker ID to look up or initialize
 * @returns The cursor position (existing or newly created)
 */
export const getOrCreateCursor = (
  db: DatabaseSync,
  workerId: string,
): number => {
  return transaction(db, () => {
    const existing = db.prepare(
      "SELECT since FROM worker_cursors WHERE worker_id = ?",
    ).get(workerId) as CursorRow | undefined;
    if (existing) return existing.since;
    const event = pushEvent(db, "runner", "cursor.create", {
      agent_id: workerId,
    });
    updateCursor(db, workerId, event.id);
    return event.id;
  });
};

/**
 * Claims an event for a worker (first-claim-wins).
 *
 * Uses INSERT OR IGNORE with the PRIMARY KEY constraint to ensure only the
 * first worker to claim an event succeeds. Emits a `claim.created` event on success.
 *
 * @param db - Database connection
 * @param workerId - Worker ID attempting the claim
 * @param eventId - Event ID to claim
 * @returns true if the claim succeeded, false if already claimed
 */
export const claimEvent = (
  db: DatabaseSync,
  workerId: string,
  eventId: number,
): boolean => {
  logger.info("Claiming event", { eventId, workerId });
  return transaction(db, () => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO claims (event_id, worker_id) VALUES (?, ?)",
    );
    insert.run(eventId, workerId);
    const check = db.prepare("SELECT worker_id FROM claims WHERE event_id = ?");
    const row = check.get(eventId) as ClaimWorkerRow | undefined;
    if (row && row.worker_id === workerId) {
      pushEvent(db, workerId, "claim.created", { event_id: eventId });
      return true;
    }
    return false;
  });
};

/**
 * Gets the claimant for an event.
 *
 * @param db - Database connection
 * @param eventId - Event ID to check
 * @returns The claim details or undefined if unclaimed
 */
export const getClaimant = (
  db: DatabaseSync,
  eventId: number,
): ClaimDetailRow | undefined => {
  const stmt = db.prepare(
    "SELECT worker_id, claimed_at FROM claims WHERE event_id = ?",
  );
  return stmt.get(eventId) as ClaimDetailRow | undefined;
};
