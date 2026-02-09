#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Unified CLI entrypoint for busytown.
 *
 * Install globally: deno task install
 * Then use from anywhere: busytown <command>
 *
 * @module cli
 */

import { Command } from "@cliffy/command";
import { join } from "node:path";
import { eventsCommand } from "./scripts/events.ts";
import {
  daemonCommand,
  restartCommand,
  runCommand,
  startCommand,
  statusCommand,
  stopCommand,
} from "./scripts/runner.ts";
import { openDb, pushEvent } from "./lib/event-queue.ts";

// import.meta.dirname resolves to the repo root (even via deno install shim)
const defaultAgentsDir = join(import.meta.dirname!, "agents");

await new Command()
  .name("busytown")
  .description("Multi-agent coordination framework.")
  .command("run", runCommand(defaultAgentsDir))
  .command("start", startCommand(defaultAgentsDir))
  .command("stop", stopCommand)
  .command("restart", restartCommand(defaultAgentsDir))
  .command("status", statusCommand)
  .command("_daemon", daemonCommand(defaultAgentsDir))
  .command("events", eventsCommand)
  .command("plan")
  .description("Push a plan.request event for a PRD file.")
  .option("--db <path:string>", "Database path", { default: "events.db" })
  .arguments("<prd-file:string>")
  .action((options, prdFile) => {
    const db = openDb(options.db);
    try {
      const event = pushEvent(db, "user", "plan.request", {
        prd_path: prdFile,
      });
      console.log(JSON.stringify(event));
    } finally {
      db.close();
    }
  })
  .parse(Deno.args);
