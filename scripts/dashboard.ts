#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/**
 * Dashboard CLI command.
 * @module dashboard
 */

import { Command } from "@cliffy/command";
import { render } from "ink";
import React from "react";
import { App } from "../lib/tui/app.tsx";
import { openDb } from "../lib/event-queue.ts";
import { loadAllAgents } from "../lib/runner.ts";

export const dashboardCommand = (defaultAgentsDir = "agents/") =>
  new Command()
    .description("Launch the real-time TUI dashboard.")
    .option(
      "--agents-dir <path:file>",
      "Directory containing agent .md files",
      { default: defaultAgentsDir },
    )
    .option("--db <path:file>", "Database path", { default: "events.db" })
    .option("--poll <ms:number>", "Poll interval in ms", { default: 500 })
    .action(async (options) => {
      const db = openDb(options.db);
      const agents = await Array.fromAsync(loadAllAgents(options.agentsDir));
      const agentIds = agents.map((a) => a.id);

      const { waitUntilExit } = render(
        React.createElement(App, {
          db,
          agentIds,
          pollIntervalMs: options.poll,
        }),
      );

      await waitUntilExit();
      db.close();
    });
