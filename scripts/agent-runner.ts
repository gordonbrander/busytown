#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * CLI wrapper for the agent runner.
 * @module agent-runner
 */

import { Command } from "@cliffy/command";
import { runPollLoop } from "../lib/agent-runner.ts";

await new Command()
  .name("agent-runner")
  .description("CLI wrapper for the agent runner.")
  .command("run")
    .description("Start the agent poll loop.")
    .option("--agents-dir <path:string>", "Directory containing agent .md files", { default: "agents/" })
    .option("--db <path:string>", "Database path", { default: "events.db" })
    .option("--poll <seconds:string>", "Poll interval in seconds", { default: "5" })
    .option("--agent <name:string>", "Only run a specific agent")
    .option("--agent-cwd <path:string>", "Working directory for sub-agents", { default: "src/" })
    .action(async (options) => {
      await runPollLoop({
        agentsDir: options.agentsDir,
        dbPath: options.db,
        pollIntervalMs: parseFloat(options.poll) * 1000,
        agentFilter: options.agent,
        agentCwd: options.agentCwd,
      });
    })
  .parse(Deno.args);
