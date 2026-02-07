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
import { openDb, transaction } from "./db.ts";
import { sleep } from "./utils.ts";

export { openDb, sleep };

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
  { sinceId = 0, limit = 100, omitWorkerId, filterWorkerId, filterType, tail }: GetEventsOptions = {},
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
  return transaction(db, () => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO claims (event_id, worker_id) VALUES (?, ?)",
    );
    insert.run(eventId, workerId);
    const check = db.prepare("SELECT worker_id FROM claims WHERE event_id = ?");
    const row = check.get(eventId) as { worker_id: string } | undefined;
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
): { worker_id: string; claimed_at: number } | undefined => {
  const stmt = db.prepare(
    "SELECT worker_id, claimed_at FROM claims WHERE event_id = ?",
  );
  return stmt.get(eventId) as
    | { worker_id: string; claimed_at: number }
    | undefined;
};
