/**
 * Shared task board (blackboard pattern) for multi-agent coordination.
 *
 * A CRUD table backed by SQLite with compare-and-swap claims for safe
 * concurrent work distribution. Mutations emit events to the event queue
 * so agents can react via their listen patterns.
 *
 * @module task-board
 */

import { DatabaseSync } from "node:sqlite";
import { openDb, transaction } from "./db.ts";
import { pushEvent } from "./event-queue.ts";

export { openDb };

// --- Types ---

export type TaskStatus =
  | "open"
  | "in_progress"
  | "done"
  | "blocked"
  | "cancelled";

export type Task = {
  id: number;
  title: string;
  content: string;
  status: TaskStatus;
  meta: unknown;
  claimed_by: string | undefined;
  created_by: string;
  created_at: number;
  updated_at: number;
};

type RawTaskRow = Omit<Task, "meta" | "claimed_by"> & {
  meta: string;
  claimed_by: string | null;
};

// --- Helpers ---

const parseRow = (row: RawTaskRow): Task => ({
  ...row,
  meta: JSON.parse(row.meta),
  claimed_by: row.claimed_by ?? undefined,
});

// --- CRUD Functions ---

/** List tasks, optionally filtering by status and/or claimed_by. */
export const listTasks = (
  db: DatabaseSync,
  filter?: { status?: TaskStatus; claimed_by?: string },
): Task[] => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.claimed_by) {
    clauses.push("claimed_by = ?");
    params.push(filter.claimed_by);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const stmt = db.prepare(`SELECT * FROM tasks${where} ORDER BY id ASC`);
  const rows = stmt.all(...params) as RawTaskRow[];
  return rows.map(parseRow);
};

/** Get a single task by ID. */
export const getTask = (
  db: DatabaseSync,
  id: number,
): Task | undefined => {
  const stmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
  const row = stmt.get(id) as RawTaskRow | undefined;
  return row ? parseRow(row) : undefined;
};

/** Add a new task. Emits a task.created event. */
export const addTask = (
  db: DatabaseSync,
  workerId: string,
  title: string,
  content = "",
  meta: unknown = {},
): Task => {
  return transaction(db, () => {
    const stmt = db.prepare(
      "INSERT INTO tasks (title, content, meta, created_by) VALUES (?, ?, ?, ?) RETURNING *",
    );
    const row = stmt.get(
      title,
      content,
      JSON.stringify(meta),
      workerId,
    ) as RawTaskRow;
    pushEvent(db, workerId, "task.created", {
      task_id: row.id,
      title: row.title,
    });
    return parseRow(row);
  });
};

/** Update a task. Requires claimed_by = workerId. Emits a task.updated event. */
export const updateTask = (
  db: DatabaseSync,
  workerId: string,
  id: number,
  updates: {
    title?: string;
    content?: string;
    status?: TaskStatus;
    meta?: unknown;
  },
): Task | undefined => {
  return transaction(db, () => {
    const sets: string[] = ["updated_at = unixepoch()"];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      sets.push("title = ?");
      params.push(updates.title);
    }
    if (updates.content !== undefined) {
      sets.push("content = ?");
      params.push(updates.content);
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.meta !== undefined) {
      sets.push("meta = ?");
      params.push(JSON.stringify(updates.meta));
    }

    params.push(id, workerId);
    const sql = `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND claimed_by = ?`;
    const stmt = db.prepare(sql);
    const result = stmt.run(...params);

    if (result.changes === 0) return undefined;

    pushEvent(db, workerId, "task.updated", {
      task_id: id,
      changes: updates,
    });
    return getTask(db, id);
  });
};

/** Delete a task. Requires claimed_by = workerId. Emits a task.deleted event. */
export const deleteTask = (
  db: DatabaseSync,
  workerId: string,
  id: number,
): boolean => {
  return transaction(db, () => {
    const stmt = db.prepare(
      "DELETE FROM tasks WHERE id = ? AND claimed_by = ?",
    );
    const result = stmt.run(id, workerId);
    if (result.changes === 0) return false;
    pushEvent(db, workerId, "task.deleted", { task_id: id });
    return true;
  });
};

/** Claim a task (CAS). Emits a task.claimed event. */
export const claimTask = (
  db: DatabaseSync,
  workerId: string,
  id: number,
): Task | undefined => {
  return transaction(db, () => {
    const stmt = db.prepare(
      "UPDATE tasks SET claimed_by = ?, status = 'in_progress', updated_at = unixepoch() WHERE id = ? AND (claimed_by IS NULL OR claimed_by = ?) AND status = 'open'",
    );
    const result = stmt.run(workerId, id, workerId);
    if (result.changes === 0) return undefined;
    pushEvent(db, workerId, "task.claimed", { task_id: id });
    return getTask(db, id);
  });
};

/** Unclaim a task. Only the holder can release. Emits a task.unclaimed event. */
export const unclaimTask = (
  db: DatabaseSync,
  workerId: string,
  id: number,
): Task | undefined => {
  return transaction(db, () => {
    const stmt = db.prepare(
      "UPDATE tasks SET claimed_by = NULL, status = 'open', updated_at = unixepoch() WHERE id = ? AND claimed_by = ?",
    );
    const result = stmt.run(id, workerId);
    if (result.changes === 0) return undefined;
    pushEvent(db, workerId, "task.unclaimed", { task_id: id });
    return getTask(db, id);
  });
};

/** Get a summary of task counts grouped by status. */
export const getTaskSummary = (
  db: DatabaseSync,
): Record<TaskStatus, number> => {
  const stmt = db.prepare(
    "SELECT status, COUNT(*) as count FROM tasks GROUP BY status",
  );
  const rows = stmt.all() as { status: TaskStatus; count: number }[];
  const summary: Record<TaskStatus, number> = {
    open: 0,
    in_progress: 0,
    done: 0,
    blocked: 0,
    cancelled: 0,
  };
  for (const row of rows) {
    summary[row.status] = row.count;
  }
  return summary;
};
