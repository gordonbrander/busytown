#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * Unified CLI entrypoint for busytown.
 *
 * Install globally: deno task install
 * Then use from anywhere: busytown <command>
 *
 * @module cli
 */

import { Command } from "@cliffy/command";
import { eventsCommand } from "./scripts/events.ts";
import { mapCommand } from "./scripts/map.ts";
import {
  daemonCommand,
  restartCommand,
  runCommand,
  startCommand,
  statusCommand,
  stopCommand,
} from "./scripts/runner.ts";
import { dashboardCommand } from "./scripts/dashboard.ts";
import { mcpServerCommand } from "./scripts/mcp-server.ts";
import { openDb, pushEvent } from "./lib/event-queue.ts";

await new Command()
  .name("busytown")
  .description("Multi-agent coordination framework.")
  .command("run", runCommand())
  .command("start", startCommand())
  .command("stop", stopCommand)
  .command("restart", restartCommand())
  .command("status", statusCommand)
  .command("_daemon", daemonCommand())
  .command("events", eventsCommand)
  .command("map", mapCommand())
  .command("dashboard", dashboardCommand())
  .command("mcp-server", mcpServerCommand)
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
