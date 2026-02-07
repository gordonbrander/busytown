#!/usr/bin/env -S deno run --allow-read --allow-write
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
import { parseArgs } from "node:util";
import { openDb, transaction } from "./db.ts";
import { pushEvent } from "./event-queue.ts";
import { die, requireOpt } from "./utils.ts";

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

// --- CLI ---

const USAGE = `Usage: task-board <command> [options]

Commands:
  list     List tasks (ndjson output).
           [--status <s>] [--claimed-by <id>]

  add      Add a new task.
           --worker <id> --title <text> [--content <text>] [--meta <json>]

  get      Get a task by ID.
           --id <n>

  update   Update a claimed task.
           --worker <id> --id <n> [--title <text>] [--content <text>]
           [--status <s>] [--meta <json>]

  delete   Delete a claimed task.
           --worker <id> --id <n>

  claim    Claim an open task (compare-and-swap).
           --worker <id> --id <n>

  unclaim  Release a claimed task.
           --worker <id> --id <n>

  summary  Show task counts by status.

Global options:
  --db <path>   Database path (default: events.db)
  --help        Show this help`;

const cli = () => {
  const { values, positionals } = parseArgs({
    args: Deno.args,
    options: {
      db: { type: "string", default: "events.db" },
      worker: { type: "string", short: "w" },
      id: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
      status: { type: "string" },
      meta: { type: "string" },
      "claimed-by": { type: "string" },
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
      case "list": {
        const filter: { status?: TaskStatus; claimed_by?: string } = {};
        if (values.status) filter.status = values.status as TaskStatus;
        if (values["claimed-by"]) filter.claimed_by = values["claimed-by"];
        const tasks = listTasks(
          db,
          Object.keys(filter).length > 0 ? filter : undefined,
        );
        for (const task of tasks) {
          console.log(JSON.stringify(task));
        }
        return;
      }

      case "add": {
        const worker = requireOpt(values.worker, "worker");
        const title = requireOpt(values.title, "title");
        const meta = values.meta ? JSON.parse(values.meta) : undefined;
        const task = addTask(db, worker, title, values.content, meta);
        console.log(JSON.stringify(task));
        return;
      }

      case "get": {
        const id = parseInt(requireOpt(values.id, "id"), 10);
        const task = getTask(db, id);
        if (!task) {
          console.error(JSON.stringify({ error: "not_found" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
        return;
      }

      case "update": {
        const worker = requireOpt(values.worker, "worker");
        const id = parseInt(requireOpt(values.id, "id"), 10);
        const updates: Record<string, unknown> = {};
        if (values.title !== undefined) updates.title = values.title;
        if (values.content !== undefined) updates.content = values.content;
        if (values.status !== undefined) updates.status = values.status;
        if (values.meta !== undefined) updates.meta = JSON.parse(values.meta);
        const task = updateTask(db, worker, id, updates);
        if (!task) {
          console.error(JSON.stringify({ error: "update_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
        return;
      }

      case "delete": {
        const worker = requireOpt(values.worker, "worker");
        const id = parseInt(requireOpt(values.id, "id"), 10);
        const ok = deleteTask(db, worker, id);
        if (!ok) {
          console.error(JSON.stringify({ error: "delete_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify({ deleted: true, task_id: id }));
        return;
      }

      case "claim": {
        const worker = requireOpt(values.worker, "worker");
        const id = parseInt(requireOpt(values.id, "id"), 10);
        const task = claimTask(db, worker, id);
        if (!task) {
          console.error(JSON.stringify({ error: "claim_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
        return;
      }

      case "unclaim": {
        const worker = requireOpt(values.worker, "worker");
        const id = parseInt(requireOpt(values.id, "id"), 10);
        const task = unclaimTask(db, worker, id);
        if (!task) {
          console.error(JSON.stringify({ error: "unclaim_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
        return;
      }

      case "summary": {
        const summary = getTaskSummary(db);
        console.log(JSON.stringify(summary));
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
  cli();
}
