#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * CLI wrapper for the agent runner with daemon management.
 * @module runner
 */

import { Command } from "@cliffy/command";
import { runMain } from "../lib/runner.ts";
import { shellEscape } from "../lib/shell.ts";
import mainLogger from "../lib/main-logger.ts";

const logger = mainLogger.child({ source: "daemon" });

// --- Constants ---

const PID_FILE = ".runner.pid";
const LOG_FILE = ".daemon-stderr.log";

// --- Utility functions ---

async function readPid(): Promise<number | null> {
  try {
    const text = await Deno.readTextFile(PID_FILE);
    const pid = parseInt(text.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function writePid(pid: number): Promise<void> {
  await Deno.writeTextFile(PID_FILE, String(pid) + "\n");
}

async function removePid(): Promise<void> {
  try {
    await Deno.remove(PID_FILE);
  } catch {
    // ignore if already gone
  }
}

async function isAlive(pid: number): Promise<boolean> {
  try {
    const cmd = new Deno.Command("kill", {
      args: ["-0", String(pid)],
      stderr: "null",
      stdout: "null",
    });
    const { success } = await cmd.output();
    return success;
  } catch {
    return false;
  }
}

/** Read PID file and check if process is alive. Cleans stale PID file. */
async function getRunningPid(): Promise<number | null> {
  const pid = await readPid();
  if (pid === null) return null;
  if (await isAlive(pid)) return pid;
  await removePid();
  return null;
}

async function killProcessTree(pid: number): Promise<void> {
  // Kill children first (the deno runner), then the parent loop
  try {
    const pkill = new Deno.Command("pkill", {
      args: ["-P", String(pid)],
      stderr: "null",
      stdout: "null",
    });
    await pkill.output();
  } catch {
    // ignore
  }
  try {
    Deno.kill(pid, "SIGTERM");
  } catch {
    // ignore if already dead
  }
}

// --- Runner option helpers ---

interface RunnerOptions {
  agentsDir: string;
  db: string;
  poll: number;
  agentCwd?: string;
  watch: string[];
  exclude?: string[];
}

/** Convert parsed runner options back to CLI args for forwarding to _daemon. */
function serializeRunnerArgs(options: RunnerOptions): string[] {
  const args: string[] = [];
  if (options.agentsDir) args.push("--agents-dir", options.agentsDir);
  if (options.db) args.push("--db", options.db);
  if (options.poll != null) args.push("--poll", String(options.poll));
  if (options.agentCwd) args.push("--agent-cwd", options.agentCwd);
  if (options.watch) {
    for (const w of options.watch) args.push("--watch", w);
  }
  if (options.exclude) {
    for (const e of options.exclude) args.push("--exclude", e);
  }
  return args;
}

/** Create a new Command with the shared runner options pre-applied. */
function commandWithRunnerOptions(
  description: string,
  defaultAgentsDir: string,
) {
  return new Command()
    .description(description)
    .option(
      "--agents-dir <path:file>",
      "Directory containing agent .md files",
      { default: defaultAgentsDir },
    )
    .option("--db <path:file>", "Database path", { default: "events.db" })
    .option("--poll <ms:number>", "Poll interval in ms", {
      default: 1000,
    })
    .option("--agent-cwd <path:file>", "Working directory for sub-agents", {
      default: ".",
    })
    .option(
      "--watch <paths:file[]>",
      "Paths to watch for FS changes",
      { default: ["."] as string[] },
    )
    .option(
      "--exclude <patterns:string[]>",
      "Comma-separated exclude patterns (exact or glob)",
    );
}

// --- Core daemon functions ---

async function startDaemon(options: RunnerOptions): Promise<void> {
  const existing = await getRunningPid();
  if (existing !== null) {
    logger.error("Daemon already running", { pid: existing });
    Deno.exit(1);
  }

  // Re-invoke the same entrypoint (works for both direct `deno run` and the installed shim)
  const entrypoint = new URL(Deno.mainModule).pathname;
  const denoArgs = [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    entrypoint,
    "_daemon",
  ];
  const runnerArgs = serializeRunnerArgs(options);
  const allArgs = [...denoArgs, ...runnerArgs];
  const shellCmd = "exec deno " + allArgs.map(shellEscape).join(" ");

  logger.info("Daemon starting...");
  const child = new Deno.Command("sh", {
    args: ["-c", shellCmd + " >> " + shellEscape(LOG_FILE) + " 2>&1"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.unref();

  await writePid(child.pid);
  logger.info("Daemon started", { pid: child.pid, log_file: LOG_FILE });
}

async function stopDaemon(): Promise<void> {
  const pid = await getRunningPid();
  if (pid === null) {
    logger.info("Daemon not running");
    await removePid();
    return;
  }

  logger.info("Daemon stopping...", { pid });
  await killProcessTree(pid);
  await removePid();
  logger.info("Daemon stopped");
}

// --- Exported command factories ---

export function runCommand(defaultAgentsDir = "agents/") {
  return commandWithRunnerOptions(
    "Start the agent poll loop (foreground).",
    defaultAgentsDir,
  ).action(async (options) => {
    await runMain({
      agentsDir: options.agentsDir,
      agentCwd: options.agentCwd ?? Deno.cwd(),
      dbPath: options.db,
      pollIntervalMs: options.poll,
      watchPaths: options.watch,
      excludePaths: options.exclude ?? [],
    });
  });
}

export function startCommand(defaultAgentsDir = "agents/") {
  return commandWithRunnerOptions(
    "Start the agent runner as a background daemon.",
    defaultAgentsDir,
  ).action(async (options) => {
    await startDaemon(options as RunnerOptions);
  });
}

export const stopCommand = new Command()
  .description("Stop the background daemon.")
  .action(async () => {
    await stopDaemon();
  });

export function restartCommand(defaultAgentsDir = "agents/") {
  return commandWithRunnerOptions(
    "Restart the background daemon.",
    defaultAgentsDir,
  ).action(async (options) => {
    await stopDaemon();
    // Brief pause to let process fully exit
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await startDaemon(options as RunnerOptions);
  });
}

export const statusCommand = new Command()
  .description("Check if the daemon is running.")
  .action(async () => {
    const pid = await getRunningPid();
    if (pid !== null) {
      logger.info("Daemon status", { pid, running: true });
    } else {
      logger.info("Daemon status", { running: false });
    }
  });

export function daemonCommand(defaultAgentsDir = "agents/") {
  return commandWithRunnerOptions(
    "Internal daemon loop (do not call directly).",
    defaultAgentsDir,
  ).hidden().action(async (options) => {
    // Auto-restart loop
    while (true) {
      logger.info("Daemon starting");
      try {
        await runMain({
          agentsDir: options.agentsDir,
          agentCwd: options.agentCwd ?? Deno.cwd(),
          dbPath: options.db,
          pollIntervalMs: options.poll,
          watchPaths: options.watch,
          excludePaths: options.exclude ?? [],
        });
      } catch (err) {
        logger.error("Daemon error", { error: String(err) });
      }
      logger.info("Daemon restarting...");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  });
}

/** Assemble the runner CLI with all subcommands. */
export function runnerCommand(defaultAgentsDir = "agents/") {
  return new Command()
    .name("runner")
    .description("Agent runner with daemon management.")
    .command("run", runCommand(defaultAgentsDir))
    .command("start", startCommand(defaultAgentsDir))
    .command("stop", stopCommand)
    .command("restart", restartCommand(defaultAgentsDir))
    .command("status", statusCommand)
    .command("_daemon", daemonCommand(defaultAgentsDir));
}

// --- Direct execution ---

if (import.meta.main) {
  await runnerCommand().parse(Deno.args);
}
