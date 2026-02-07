#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * CLI wrapper for the agent runner.
 * @module agent-runner
 */

import { parseArgs } from "node:util";
import { runPollLoop } from "../lib/agent-runner.ts";
import { die } from "../lib/utils.ts";

// --- CLI ---

const USAGE = `Usage: agent-runner run [options]

Commands:
  run    Start the agent poll loop

Options:
  --agents-dir <path>   Directory containing agent .md files (default: agents/)
  --db <path>           Database path (default: events.db)
  --poll <seconds>      Poll interval in seconds (default: 5)
  --agent <name>        Only run a specific agent
  --help                Show this help`;

const cli = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: Deno.args,
    options: {
      "agents-dir": { type: "string", default: "agents/" },
      db: { type: "string", default: "events.db" },
      poll: { type: "string", default: "5" },
      agent: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    Deno.exit(0);
  }

  const command = positionals[0];

  if (command !== "run") die(`Unknown command: ${command}\n\n${USAGE}`);

  await runPollLoop({
    agentsDir: values["agents-dir"]!,
    dbPath: values.db!,
    pollIntervalMs: parseFloat(values.poll!) * 1000,
    agentFilter: values.agent,
  });
};

if (import.meta.main) {
  await cli();
}
