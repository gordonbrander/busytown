/**
 * Agent runner that polls the event queue, matches events to agent definitions,
 * and invokes agents as headless Claude Code instances (`claude --print`).
 *
 * Agents are defined as markdown files with YAML frontmatter specifying which
 * event types they listen for. Multiple agents collaborate asynchronously via
 * the shared SQLite event queue.
 *
 * @module runner
 */

import { extractYaml } from "@std/front-matter";
import { basename, join, resolve } from "node:path";
import type { Event } from "./event.ts";
import { matchesListen } from "./event.ts";
import type { DatabaseSync } from "node:sqlite";
import {
  getEventsSince,
  getOrCreateCursor,
  openDb,
  pollEvents,
  pushEvent,
  updateCursor,
} from "./event-queue.ts";
import { runFsWatcher } from "./fs-watcher.ts";
import mainLogger from "./main-logger.ts";
import { sleep } from "./utils.ts";
import { pipeStreamToFile } from "./stream.ts";

const logger = mainLogger.child({ component: "runner" });

const POLL_BATCH_SIZE = 100;

export type AgentDef = {
  id: string;
  description: string;
  listen: string[];
  allowedTools: string[];
  systemPrompt: string;
  filePath: string;
};

export type RunnerConfig = {
  agentsDir: string;
  dbPath: string;
  pollIntervalMs: number;
  agentFilter?: string;
  agentCwd: string;
  watchPaths: string[];
  excludePaths: string[];
};

/** Load a single agent definition from a markdown file with YAML frontmatter. */
export const loadAgentDef = async (filePath: string): Promise<AgentDef> => {
  const raw = await Deno.readTextFile(filePath);
  const { attrs, body } = extractYaml(raw) as {
    attrs: Record<string, unknown>;
    body: string;
  };
  const id = basename(filePath, ".md");
  const description = (attrs.description as string) ?? "";
  const listen = (attrs.listen as string[]) ?? ["*"];
  const allowedTools = (attrs.allowed_tools as string[] | undefined) ?? [];
  return {
    id,
    description,
    listen,
    allowedTools,
    systemPrompt: body.trim(),
    filePath,
  };
};

/** Load all agent definitions from a directory, optionally filtering to one. */
export const loadAllAgents = async (
  agentsDir: string,
  agentFilter?: string,
): Promise<AgentDef[]> => {
  const agents: AgentDef[] = [];
  try {
    for await (const entry of Deno.readDir(agentsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      if (agentFilter && basename(entry.name, ".md") !== agentFilter) continue;
      agents.push(await loadAgentDef(join(agentsDir, entry.name)));
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return agents;
    throw err;
  }
  return agents;
};

/** Build the full system prompt for an agent invocation. */
export const buildSystemPrompt = (
  agent: AgentDef,
  dbPath: string,
): string => {
  const header = `You are the "${agent.id}" agent. ${agent.description}

## Pushing events

To push events to the queue, run:
  busytown events push --worker ${agent.id} --db ${dbPath} --type <type> --payload '<json>'

where <type> is the event type and <json> is an optional JSON payload (defaults to {}).

## Claiming events

To claim an event (first-claim-wins):
  busytown events claim --worker ${agent.id} --db ${dbPath} --event <id>

To check who claimed an event:
  busytown events check-claim --db ${dbPath} --event <id>

Claim an event before working on it. If the claim response shows claimed:false, another worker already claimed it — move on.

---

`;
  return header + agent.systemPrompt;
};

/** Build --allowedTools CLI args. Auto-injects events Bash permissions. */
export const buildToolArgs = (
  allowedTools: string[],
): string[] => {
  // Omit the `--allowedTools` arg if *
  if (allowedTools.includes("*")) return [];
  const tools = [
    ...allowedTools,
    "Bash(busytown events:*)",
  ];
  return ["--allowedTools", tools.join(" ")];
};

const textEncoder = new TextEncoder();

/** Invoke an agent as a headless Claude Code instance. */
export const runAgent = async (
  agent: AgentDef,
  event: Event,
  dbPath: string,
  projectRoot: string,
): Promise<number> => {
  const systemPrompt = buildSystemPrompt(agent, dbPath);
  const userMessage = JSON.stringify(event);
  const toolArgs = buildToolArgs(agent.allowedTools);

  const logsDir = join(projectRoot, "logs");
  await Deno.mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `${agent.id}.log`);
  const logFile = await Deno.open(logPath, {
    write: true,
    create: true,
    append: true,
  });

  const cmd = new Deno.Command("claude", {
    args: [
      "--print",
      "--system-prompt",
      systemPrompt,
      "--verbose",
      "--output-format",
      "stream-json",
      ...toolArgs,
    ],
    cwd: projectRoot,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(textEncoder.encode(userMessage));
  await writer.close();

  const stdoutPipe = pipeStreamToFile(process.stdout, logFile);
  const stderrPipe = pipeStreamToFile(process.stderr, logFile);

  const { code } = await process.status;
  await Promise.all([stdoutPipe, stderrPipe]);
  logFile.close();

  return code;
};

/** Process events serially for a single agent, advancing cursor after each. */
const forkAgent = async (
  agent: AgentDef,
  db: DatabaseSync,
  dbPath: string,
  projectRoot: string,
): Promise<boolean> => {
  try {
    const since = getOrCreateCursor(db, agent.id);
    // omitWorkerId excludes the agent's own events (including lifecycle events it
    // pushed). This prevents self-triggering: the cursor still advances past the
    // agent's own events, but they are never yielded for matching.
    const allEvents = getEventsSince(db, {
      sinceId: since,
      limit: POLL_BATCH_SIZE,
      omitWorkerId: agent.id,
    });

    for (const event of allEvents) {
      if (matchesListen(event, agent)) {
        pushEvent(db, agent.id, "agent.start", {
          event_id: event.id,
          event_type: event.type,
        });
        const exitCode = await runAgent(agent, event, dbPath, projectRoot);
        if (exitCode === 0) {
          pushEvent(db, agent.id, "agent.finish", {
            event_id: event.id,
            event_type: event.type,
          });
        } else {
          pushEvent(db, agent.id, "agent.error", {
            event_id: event.id,
            event_type: event.type,
            exit_code: exitCode,
          });
        }
      }
      updateCursor(db, agent.id, event.id);
    }
    return true;
  } catch (err) {
    logger.error("Agent fork failed", { agent: agent.id, error: err });
    return false;
  }
};

/** Poll loop: loads agents, polls events, dispatches to matching agents. */
export const runPollLoop = async ({
  agentsDir,
  agentCwd,
  agentFilter,
  dbPath,
  pollIntervalMs,
}: RunnerConfig) => {
  logger.info("Poll loop start", {
    db: dbPath,
    interval_ms: pollIntervalMs,
  });

  const db = openDb(dbPath);
  const projectRoot = resolve(agentCwd ?? Deno.cwd());

  try {
    while (true) {
      // Emit all new events as NDJSON on stdout
      const stdoutEvents = pollEvents(db, "_stdout", POLL_BATCH_SIZE);
      for (const event of stdoutEvents) {
        console.log(JSON.stringify(event));
      }

      // Load agents fresh each time, so we pick up new ones
      const agents = await loadAllAgents(agentsDir, agentFilter);

      const forks = agents.map((agent) =>
        forkAgent(agent, db, dbPath, projectRoot)
      );
      // Wait until this batch of forks completes.
      // Agents run in parallel, but each agent fork processes each event sequentially.
      // Waiting for the parallel forks to settle ensures that each agent's cursor
      // advances without skipping over any events.
      await Promise.allSettled(forks);

      await sleep(pollIntervalMs);
    }
  } finally {
    db.close();
  }
};

/** Main poll loop: loads agents, polls events, dispatches to matching agents. */
export const runLoop = async (config: RunnerConfig): Promise<void> => {
  const agentLoopPromise = runPollLoop(config);

  const watcherPromise = runFsWatcher({
    watchPaths: config.watchPaths,
    excludePaths: config.excludePaths,
    dbPath: config.dbPath,
    agentCwd: config.agentCwd,
  });

  await Promise.all([agentLoopPromise, watcherPromise]);
};
