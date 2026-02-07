/**
 * Agent runner that polls the event queue, matches events to agent definitions,
 * and invokes agents as headless Claude Code instances (`claude --print`).
 *
 * Agents are defined as markdown files with YAML frontmatter specifying which
 * event types they listen for. Multiple agents collaborate asynchronously via
 * the shared SQLite event queue.
 *
 * @module agent-runner
 */

import { extractYaml } from "@std/front-matter";
import { basename, join, resolve } from "node:path";
import { type Event, openDb, pollEvents } from "./event-queue.ts";
import { Logger } from "./logger.ts";
import { sleep } from "./utils.ts";

const logger = new Logger({ component: "agent-runner" });

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
  agentCwd?: string;
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

/** Check if an event matches an agent's listen patterns. */
export const matchesListen = (event: Event, agent: AgentDef): boolean => {
  for (const pattern of agent.listen) {
    if (pattern === "*") {
      // Wildcard matches everything except events from self
      if (event.worker_id !== agent.id) return true;
    } else if (pattern.endsWith(".*")) {
      // Prefix glob: "task.*" matches "task.created", "task.done", etc.
      const prefix = pattern.slice(0, -1);
      if (event.type.startsWith(prefix)) return true;
    } else {
      // Exact match
      if (event.type === pattern) return true;
    }
  }
  return false;
};

/** Build the full system prompt for an agent invocation. */
export const buildSystemPrompt = (
  agent: AgentDef,
  dbPath: string,
): string => {
  const header = `You are the "${agent.id}" agent. ${agent.description}

## Pushing events

To push events to the queue, run:
  deno task event-queue push --worker ${agent.id} --db ${dbPath} --type <type> --payload '<json>'

where <type> is the event type and <json> is an optional JSON payload (defaults to {}).

## Claiming events

To claim an event (first-claim-wins):
  deno task event-queue claim --worker ${agent.id} --db ${dbPath} --event <id>

To check who claimed an event:
  deno task event-queue check-claim --db ${dbPath} --event <id>

Claim an event before working on it. If the claim response shows claimed:false, another worker already claimed it — move on.

---

`;
  return header + agent.systemPrompt;
};

/** Build --allowedTools CLI args. Auto-injects event-queue Bash permissions. */
export const buildToolArgs = (
  allowedTools: string[],
): string[] => {
  // Omit the `--allowedTools` arg if *
  if (allowedTools.includes("*")) return [];
  const tools = [
    ...allowedTools,
    "Bash(deno task event-queue:*)",
  ];
  return ["--allowedTools", tools.join(" ")];
};

const textEncoder = new TextEncoder();

/** Invoke an agent as a headless Claude Code instance. */
export const runAgent = async (
  agent: AgentDef,
  events: Event[],
  dbPath: string,
  projectRoot: string,
): Promise<void> => {
  logger.info("Agent running", { agent: agent.id });
  const systemPrompt = buildSystemPrompt(agent, dbPath);
  const userMessage = JSON.stringify(events);
  const toolArgs = buildToolArgs(agent.allowedTools);

  const cmd = new Deno.Command("claude", {
    args: [
      "--print",
      "--system-prompt",
      systemPrompt,
      "--output-format",
      "text",
      ...toolArgs,
    ],
    cwd: projectRoot,
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  });

  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(textEncoder.encode(userMessage));
  await writer.close();

  const { code } = await process.output();

  if (code !== 0) {
    logger.error("Agent exit", { agent: agent.id, code });
  } else {
    logger.info("Agent completed", { agent: agent.id });
  }
};

/** Filter polled events to those matching an agent's listen patterns. */
export const filterMatchedEvents = (
  events: Event[],
  agent: AgentDef,
): Event[] => events.filter((e) => matchesListen(e, agent));

/** Main poll loop: loads agents, polls events, dispatches to matching agents. */
export const runPollLoop = async (config: RunnerConfig): Promise<void> => {
  const agentsDir = resolve(config.agentsDir);
  const dbPath = resolve(config.dbPath);

  const projectRoot = resolve(config.agentCwd ?? Deno.cwd());
  const db = openDb(dbPath);

  logger.info("Poll loop start", {
    db: dbPath,
    interval_ms: config.pollIntervalMs,
  });

  try {
    while (true) {
      // Load agents fresh each time, so we pick up new ones
      const agents = await loadAllAgents(agentsDir, config.agentFilter);
      logger.info("Poll", {
        db: dbPath,
        interval_ms: config.pollIntervalMs,
        agents: agents.map((agent) => agent.id),
      });

      for (const agent of agents) {
        // Poll with per-agent cursor, excluding events from self
        const allEvents = pollEvents(db, agent.id, 100, agent.id);
        const matched = filterMatchedEvents(allEvents, agent);
        if (matched.length === 0) continue;

        logger.info("dispatch", {
          agent: agent.id,
          count: matched.length,
          event_types: matched.map((e) => e.type),
        });

        runAgent(agent, matched, dbPath, projectRoot);
      }

      await sleep(config.pollIntervalMs);
    }
  } finally {
    db.close();
  }
};
