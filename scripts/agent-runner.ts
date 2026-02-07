#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * CLI wrapper for the agent runner with daemon management.
 * @module agent-runner
 */

import { Command } from "@cliffy/command";
import { runPollLoop } from "../lib/agent-runner.ts";
import { Logger } from "../lib/logger.ts";

const logger = new Logger({ component: "daemon" });

// --- Constants ---

const PID_FILE = ".agent-runner.pid";
const LOG_FILE = ".agent-runner.log";

// --- Utility functions ---

/** Single-quote escape a string for safe shell inclusion. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

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
    const cmd = new Deno.Command("kill", { args: ["-0", String(pid)], stderr: "null", stdout: "null" });
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
    const pkill = new Deno.Command("pkill", { args: ["-P", String(pid)], stderr: "null", stdout: "null" });
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

// deno-lint-ignore no-explicit-any
type RunnerOptions = Record<string, any>;

/** Convert parsed runner options back to CLI args for forwarding to _daemon. */
function serializeRunnerArgs(options: RunnerOptions): string[] {
  const args: string[] = [];
  if (options.agentsDir) args.push("--agents-dir", options.agentsDir);
  if (options.db) args.push("--db", options.db);
  if (options.poll) args.push("--poll", options.poll);
  if (options.agent) args.push("--agent", options.agent);
  if (options.agentCwd) args.push("--agent-cwd", options.agentCwd);
  return args;
}

/** Execute the poll loop with the given CLI options. */
async function execRunPollLoop(options: RunnerOptions): Promise<void> {
  await runPollLoop({
    agentsDir: options.agentsDir,
    dbPath: options.db,
    pollIntervalMs: parseFloat(options.poll) * 1000,
    agentFilter: options.agent,
    agentCwd: options.agentCwd,
  });
}

// --- Core daemon functions ---

async function startDaemon(options: RunnerOptions): Promise<void> {
  const existing = await getRunningPid();
  if (existing !== null) {
    logger.error("already_running", { pid: existing });
    Deno.exit(1);
  }

  // Build the shell command that execs into deno running _daemon
  const denoArgs = ["run", "--allow-read", "--allow-write", "--allow-run", "scripts/agent-runner.ts", "_daemon"];
  const runnerArgs = serializeRunnerArgs(options);
  const allArgs = [...denoArgs, ...runnerArgs];
  const shellCmd = "exec deno " + allArgs.map(shellEscape).join(" ");

  logger.info("daemon_starting");
  const child = new Deno.Command("sh", {
    args: ["-c", shellCmd + " >> " + shellEscape(LOG_FILE) + " 2>&1"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.unref();

  await writePid(child.pid);
  logger.info("daemon_started", { pid: child.pid, log_file: LOG_FILE });
}

async function stopDaemon(): Promise<void> {
  const pid = await getRunningPid();
  if (pid === null) {
    logger.info("daemon_not_running");
    await removePid();
    return;
  }

  logger.info("daemon_stopping", { pid });
  await killProcessTree(pid);
  await removePid();
  logger.info("daemon_stopped");
}

// --- Command definitions ---

const runCmd = new Command()
  .description("Start the agent poll loop (foreground).")
  .option("--agents-dir <path:string>", "Directory containing agent .md files", { default: "agents/" })
  .option("--db <path:string>", "Database path", { default: "events.db" })
  .option("--poll <seconds:string>", "Poll interval in seconds", { default: "5" })
  .option("--agent <name:string>", "Only run a specific agent")
  .option("--agent-cwd <path:string>", "Working directory for sub-agents", { default: "src/" })
  .action(async (options) => {
    await execRunPollLoop(options);
  });

const startCmd = new Command()
  .description("Start the agent runner as a background daemon.")
  .option("--agents-dir <path:string>", "Directory containing agent .md files", { default: "agents/" })
  .option("--db <path:string>", "Database path", { default: "events.db" })
  .option("--poll <seconds:string>", "Poll interval in seconds", { default: "5" })
  .option("--agent <name:string>", "Only run a specific agent")
  .option("--agent-cwd <path:string>", "Working directory for sub-agents", { default: "src/" })
  .action(async (options) => {
    await startDaemon(options);
  });

const stopCmd = new Command()
  .description("Stop the background daemon.")
  .action(async () => {
    await stopDaemon();
  });

const restartCmd = new Command()
  .description("Restart the background daemon.")
  .option("--agents-dir <path:string>", "Directory containing agent .md files", { default: "agents/" })
  .option("--db <path:string>", "Database path", { default: "events.db" })
  .option("--poll <seconds:string>", "Poll interval in seconds", { default: "5" })
  .option("--agent <name:string>", "Only run a specific agent")
  .option("--agent-cwd <path:string>", "Working directory for sub-agents", { default: "src/" })
  .action(async (options) => {
    await stopDaemon();
    // Brief pause to let process fully exit
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await startDaemon(options);
  });

const statusCmd = new Command()
  .description("Check if the daemon is running.")
  .action(async () => {
    const pid = await getRunningPid();
    if (pid !== null) {
      logger.info("daemon_status", { pid, running: true });
    } else {
      logger.info("daemon_status", { running: false });
    }
  });

const daemonCmd = new Command()
  .description("Internal daemon loop (do not call directly).")
  .hidden()
  .option("--agents-dir <path:string>", "Directory containing agent .md files", { default: "agents/" })
  .option("--db <path:string>", "Database path", { default: "events.db" })
  .option("--poll <seconds:string>", "Poll interval in seconds", { default: "5" })
  .option("--agent <name:string>", "Only run a specific agent")
  .option("--agent-cwd <path:string>", "Working directory for sub-agents", { default: "src/" })
  .action(async (options) => {
    // Auto-restart loop, same as daemon.sh's _loop
    while (true) {
      logger.info("runner_start");
      try {
        await execRunPollLoop(options);
      } catch (err) {
        logger.error("runner_error", { error: String(err) });
      }
      logger.info("runner_restarting");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  });

// --- Top-level assembly ---

await new Command()
  .name("agent-runner")
  .description("Agent runner with daemon management.")
  .command("run", runCmd)
  .command("start", startCmd)
  .command("stop", stopCmd)
  .command("restart", restartCmd)
  .command("status", statusCmd)
  .command("_daemon", daemonCmd)
  .parse(Deno.args);
