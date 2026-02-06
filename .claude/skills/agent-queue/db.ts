/**
 * Shared database initialization for the agent queue system.
 *
 * Opens a SQLite database with WAL mode and initializes all schemas
 * (events, worker_cursors, tasks) in a single call.
 *
 * @module db
 */

import { DatabaseSync } from "node:sqlite";

/**
 * Opens a SQLite database and initializes all schemas.
 *
 * Enables WAL mode, busy timeout, and foreign keys, then creates the
 * `events`, `worker_cursors`, and `tasks` tables if they don't exist.
 *
 * @param path - Path to the SQLite database file
 * @returns The opened database connection
 */
export const openDb = (path: string): DatabaseSync => {
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

  // Tasks schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'done', 'blocked', 'cancelled')),
      meta TEXT NOT NULL DEFAULT '{}',
      claimed_by TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by)",
  );

  return db;
};

/** Run a function inside a BEGIN/COMMIT transaction with ROLLBACK on error. */
export const transaction = <T>(db: DatabaseSync, fn: () => T): T => {
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
