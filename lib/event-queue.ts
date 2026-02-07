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
import { openDb } from "./db.ts";
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
 * Fetches events after a given event ID.
 *
 * @param db - Database connection
 * @param sinceId - Return events with ID greater than this value
 * @param limit - Maximum number of events to return (default: 100)
 * @param omitWorkerId - Optional worker ID to exclude from results
 * @param filterWorkerId - Optional worker ID to include exclusively
 * @returns Array of events ordered by ID ascending
 */
export const getEventsSince = (
  db: DatabaseSync,
  sinceId: number,
  limit = 100,
  omitWorkerId?: string,
  filterWorkerId?: string,
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
  sql += " ORDER BY id ASC LIMIT ?";
  params.push(limit);
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as RawEventRow[];
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
