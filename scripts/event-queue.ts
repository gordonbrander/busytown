#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * CLI wrapper for the event queue.
 * @module event-queue
 */

import { Command } from "@cliffy/command";
import {
  getEventsSince,
  getSince,
  openDb,
  pollEvents,
  pushEvent,
  sleep,
  updateCursor,
} from "../lib/event-queue.ts";
import { die } from "../lib/utils.ts";

/** Reads JSON input from stdin, returns "{}" if empty. */
const readStdin = async (): Promise<string> => {
  const buf = new Uint8Array(1024 * 1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return "{}";
  return new TextDecoder().decode(buf.subarray(0, n)).trim() || "{}";
};

await new Command()
  .name("event-queue")
  .description("CLI wrapper for the event queue.")
  .globalOption("--db <path:string>", "Database path", { default: "events.db" })

  .command("watch")
    .description("Poll for new events and stream ndjson to stdout.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--poll <seconds:string>", "Poll interval in seconds", { default: "3" })
    .option("--omit-worker <id:string>", "Omit events from this worker")
    .action(async (options) => {
      const db = openDb(options.db);
      try {
        const intervalMs = parseFloat(options.poll) * 1000;
        const encoder = new TextEncoder();
        const write = (s: string) => Deno.stdout.writeSync(encoder.encode(s));
        while (true) {
          const events = pollEvents(db, options.worker, 100, options.omitWorker);
          for (const event of events) {
            write(JSON.stringify(event) + "\n");
          }
          await sleep(intervalMs);
        }
      } finally {
        db.close();
      }
    })

  .command("push")
    .description("Push an event. Reads { type, payload } from --data or stdin.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--data <json:string>", "JSON data with type and payload")
    .action(async (options) => {
      const db = openDb(options.db);
      try {
        const raw = options.data ?? await readStdin();
        const { type, payload = {} } = JSON.parse(raw) as {
          type?: string;
          payload?: unknown;
        };
        if (type == undefined) {
          return die('Input must include a "type" field');
        }
        const id = pushEvent(db, options.worker, type, payload);
        console.log(JSON.stringify({ id }));
      } finally {
        db.close();
      }
    })

  .command("since")
    .description("Get the cursor for a worker.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .action((options) => {
      const db = openDb(options.db);
      try {
        const since = getSince(db, options.worker);
        console.log(JSON.stringify({ worker_id: options.worker, since }));
      } finally {
        db.close();
      }
    })

  .command("events")
    .description("Get events after a given id.")
    .option("--since <id:string>", "Event ID to start after", { required: true })
    .option("--limit <n:string>", "Maximum number of events")
    .option("--omit-worker <id:string>", "Omit events from this worker")
    .option("--worker <id:string>", "Only show events from this worker")
    .option("--type <type:string>", "Only show events of this type (* = all)", { default: "*" })
    .action((options) => {
      const db = openDb(options.db);
      try {
        const sinceId = parseInt(options.since, 10);
        const limit = options.limit ? parseInt(options.limit, 10) : 100;
        const events = getEventsSince(db, sinceId, limit, options.omitWorker, options.worker, options.type);
        for (const event of events) {
          console.log(JSON.stringify(event));
        }
      } finally {
        db.close();
      }
    })

  .command("cursor")
    .description("Set the cursor for a worker.")
    .option("--worker <id:string>", "Worker ID", { required: true })
    .option("--set <event_id:string>", "Event ID to set cursor to", { required: true })
    .action((options) => {
      const db = openDb(options.db);
      try {
        const sinceId = parseInt(options.set, 10);
        updateCursor(db, options.worker, sinceId);
        console.log(JSON.stringify({ worker_id: options.worker, since: sinceId }));
      } finally {
        db.close();
      }
    })

  .parse(Deno.args);
