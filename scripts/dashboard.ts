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

export const dashboardCommand = () =>
  new Command()
    .description("Launch the real-time TUI dashboard.")
    .option("--db <path:file>", "Database path", { default: "events.db" })
    .option("--poll <ms:number>", "Poll interval in ms", { default: 500 })
    .action(async (options) => {
      const db = openDb(options.db);

      const { waitUntilExit } = render(
        React.createElement(App, {
          db,
          pollIntervalMs: options.poll,
        }),
      );

      await waitUntilExit();
      db.close();
    });
