#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * CLI wrapper for the event queue.
 * @module event-queue
 */

import { parseArgs } from "node:util";
import {
  getEventsSince,
  getSince,
  openDb,
  pollEvents,
  pushEvent,
  sleep,
  updateCursor,
} from "./lib/event-queue.ts";
import { die, requireOpt } from "./lib/utils.ts";

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
