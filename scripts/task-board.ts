#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * CLI wrapper for the task board.
 * @module task-board
 */

import { Command } from "@cliffy/command";
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

await new Command()
  .name("task-board")
  .description("CLI wrapper for the task board.")
  .globalOption("--db <path:string>", "Database path", { default: "events.db" })

  .command("list")
    .description("List tasks (ndjson output).")
    .option("--status <s:string>", "Filter by status")
    .option("--claimed-by <id:string>", "Filter by claimed worker")
    .action((options) => {
      const db = openDb(options.db);
      try {
        const filter: { status?: TaskStatus; claimed_by?: string } = {};
        if (options.status) filter.status = options.status as TaskStatus;
        if (options.claimedBy) filter.claimed_by = options.claimedBy;
        const tasks = listTasks(
          db,
          Object.keys(filter).length > 0 ? filter : undefined,
        );
        for (const task of tasks) {
          console.log(JSON.stringify(task));
        }
      } finally {
        db.close();
      }
    })

  .command("add")
    .description("Add a new task.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--title <text:string>", "Task title", { required: true })
    .option("--content <text:string>", "Task content")
    .option("--meta <json:string>", "Task metadata as JSON")
    .action((options) => {
      const db = openDb(options.db);
      try {
        const meta = options.meta ? JSON.parse(options.meta) : undefined;
        const task = addTask(db, options.worker, options.title, options.content, meta);
        console.log(JSON.stringify(task));
      } finally {
        db.close();
      }
    })

  .command("get")
    .description("Get a task by ID.")
    .option("--id <n:string>", "Task ID", { required: true })
    .action((options) => {
      const db = openDb(options.db);
      try {
        const id = parseInt(options.id, 10);
        const task = getTask(db, id);
        if (!task) {
          console.error(JSON.stringify({ error: "not_found" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
      } finally {
        db.close();
      }
    })

  .command("update")
    .description("Update a claimed task.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--id <n:string>", "Task ID", { required: true })
    .option("--title <text:string>", "New title")
    .option("--content <text:string>", "New content")
    .option("--status <s:string>", "New status")
    .option("--meta <json:string>", "New metadata as JSON")
    .action((options) => {
      const db = openDb(options.db);
      try {
        const id = parseInt(options.id, 10);
        const updates: Record<string, unknown> = {};
        if (options.title !== undefined) updates.title = options.title;
        if (options.content !== undefined) updates.content = options.content;
        if (options.status !== undefined) updates.status = options.status;
        if (options.meta !== undefined) updates.meta = JSON.parse(options.meta);
        const task = updateTask(db, options.worker, id, updates);
        if (!task) {
          console.error(JSON.stringify({ error: "update_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
      } finally {
        db.close();
      }
    })

  .command("delete")
    .description("Delete a claimed task.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--id <n:string>", "Task ID", { required: true })
    .action((options) => {
      const db = openDb(options.db);
      try {
        const id = parseInt(options.id, 10);
        const ok = deleteTask(db, options.worker, id);
        if (!ok) {
          console.error(JSON.stringify({ error: "delete_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify({ deleted: true, task_id: id }));
      } finally {
        db.close();
      }
    })

  .command("claim")
    .description("Claim an open task (compare-and-swap).")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--id <n:string>", "Task ID", { required: true })
    .action((options) => {
      const db = openDb(options.db);
      try {
        const id = parseInt(options.id, 10);
        const task = claimTask(db, options.worker, id);
        if (!task) {
          console.error(JSON.stringify({ error: "claim_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
      } finally {
        db.close();
      }
    })

  .command("unclaim")
    .description("Release a claimed task.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--id <n:string>", "Task ID", { required: true })
    .action((options) => {
      const db = openDb(options.db);
      try {
        const id = parseInt(options.id, 10);
        const task = unclaimTask(db, options.worker, id);
        if (!task) {
          console.error(JSON.stringify({ error: "unclaim_failed" }));
          Deno.exit(1);
        }
        console.log(JSON.stringify(task));
      } finally {
        db.close();
      }
    })

  .command("summary")
    .description("Show task counts by status.")
    .action((options) => {
      const db = openDb(options.db);
      try {
        const summary = getTaskSummary(db);
        console.log(JSON.stringify(summary));
      } finally {
        db.close();
      }
    })

  .parse(Deno.args);
