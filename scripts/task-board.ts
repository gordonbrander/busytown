#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * CLI wrapper for the task board.
 * @module task-board
 */

import { parseArgs } from "node:util";
import { openDb } from "../lib/db.ts";
import {
  addTask,
  claimTask,
  deleteTask,
  getTask,
  getTaskSummary,
  listTasks,
  type TaskStatus,
  unclaimTask,
  updateTask,
} from "../lib/task-board.ts";
import { die, requireOpt } from "../lib/utils.ts";

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
