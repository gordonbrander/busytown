#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/**
 * Dashboard CLI command.
 * @module dashboard
 */

import { Command } from "@cliffy/command";
import { render } from "ink";
import React from "react";
import { App } from "../lib/tui/app.tsx";
import { openDb, updateCursor } from "../lib/event-queue.ts";
import { loadAllAgents } from "../lib/runner.ts";
import { createSystem, worker } from "../lib/worker.ts";
import type { DispatchRef } from "../lib/tui/state.ts";

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

      const system = createSystem(db, options.poll);

      // Bridge: worker writes, React reads
      const dispatchRef: DispatchRef = { current: null };

      // Reset TUI cursor to tail (start fresh, don't replay history)
      const maxRow = db.prepare("SELECT MAX(id) as maxId FROM events").get() as
        | { maxId: number | null }
        | undefined;
      if (maxRow?.maxId) updateCursor(db, "__tui__", maxRow.maxId);

      // Spawn hidden worker — receives every event, dispatches to reducer
      system.spawn(
        worker({
          id: "_tui",
          listen: ["*"],
          hidden: true,
          run: (event) => {
            dispatchRef.current?.({ type: "EVENT_RECEIVED", event });
          },
        }),
      );

      const { waitUntilExit } = render(
        React.createElement(App, { db, agentIds, dispatchRef }),
      );

      await waitUntilExit();
      await system.stop();
      db.close();
    });
