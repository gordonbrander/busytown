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
import { openDb } from "./db.ts";
import { type Event, pollEvents } from "./event-queue.ts";
import { sleep } from "./utils.ts";

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

/** Format events as readable text for an agent's user message. */
export const formatEventsForPrompt = (events: Event[]): string => {
  return events
    .map(
      (e) =>
        `[Event #${e.id}] type=${e.type} worker=${e.worker_id} time=${
          new Date(e.timestamp * 1000).toISOString()
        }\n${JSON.stringify(e.payload, null, 2)}`,
    )
    .join("\n\n");
};

/** Build the full system prompt for an agent invocation. */
export const buildSystemPrompt = (
  agent: AgentDef,
  dbPath: string,
): string => {
  const header = `You are the "${agent.id}" agent. ${agent.description}

## Pushing events

To push events to the queue, run:
  deno task event-queue push --worker ${agent.id} --db ${dbPath} --data '<json>'

where <json> is a JSON object with "type" and optional "payload" fields.

## Task board

A shared task board is available for coordinating work with other agents.

Commands:
  deno task task-board list --db ${dbPath} [--status <s>] [--claimed-by <id>]
  deno task task-board add --worker ${agent.id} --db ${dbPath} --title <text> [--content <text>] [--meta <json>]
  deno task task-board get --id <n> --db ${dbPath}
  deno task task-board claim --worker ${agent.id} --id <n> --db ${dbPath}
  deno task task-board unclaim --worker ${agent.id} --id <n> --db ${dbPath}
  deno task task-board update --worker ${agent.id} --id <n> --db ${dbPath} [--title/--content/--status <val>] [--meta <json>]
  deno task task-board delete --worker ${agent.id} --id <n> --db ${dbPath}
  deno task task-board summary --db ${dbPath}

Claim a task before working on it. Only the claim holder can update or delete a task.
If a claim fails (exit code 1), the task is already taken — try another task.

---

`;
  return header + agent.systemPrompt;
};

/** Build --allowedTools CLI args. Auto-injects event-queue and task-board Bash permissions. */
export const buildToolArgs = (
  allowedTools: string[],
): string[] => {
  // Omit the `--allowedTools` arg if *
  if (allowedTools.includes("*")) return [];
  const tools = [
    ...allowedTools,
    "Bash(deno task event-queue:*)",
    "Bash(deno task task-board:*)",
  ];
  return ["--allowedTools", tools.join(" ")];
};

/** Invoke an agent as a headless Claude Code instance. */
export const invokeAgent = async (
  agent: AgentDef,
  events: Event[],
  dbPath: string,
  projectRoot: string,
): Promise<{ success: boolean; output: string }> => {
  const systemPrompt = buildSystemPrompt(agent, dbPath);
  const userMessage = formatEventsForPrompt(events);
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
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(userMessage));
  await writer.close();

  const { code, stdout, stderr } = await process.output();
  const out = new TextDecoder().decode(stdout);
  const err = new TextDecoder().decode(stderr);

  if (code !== 0) {
    console.error(`[${agent.id}] claude exited with code ${code}`);
    if (err) console.error(`[${agent.id}] stderr: ${err}`);
  }

  return { success: code === 0, output: out || err };
};

/** Format an agent invocation result for console output. */
export const formatAgentOutput = (
  agentId: string,
  success: boolean,
  output: string,
): string => {
  const status = success ? "completed" : "failed";
  const header = `[${agentId}] ${status}`;
  const trimmed = output.trim();
  if (!trimmed) return header;
  const indented = trimmed.split("\n").map((l) => `  ${l}`).join("\n");
  return `${header}\n${indented}`;
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
  const running = new Set<string>();
  const knownAgents = new Set<string>();

  console.log(`Polling ${dbPath} every ${config.pollIntervalMs}ms...\n`);

  try {
    while (true) {
      const agents = await loadAllAgents(agentsDir, config.agentFilter);

      // Log newly discovered agents
      for (const a of agents) {
        if (knownAgents.has(a.id)) continue;
        const toolInfo = a.allowedTools.includes("*")
          ? "tools: all"
          : `tools: [${a.allowedTools.join(", ")}]`;
        console.log(
          `  ${a.id} — listens: [${a.listen.join(", ")}] — ${toolInfo}`,
        );
        knownAgents.add(a.id);
      }

      for (const agent of agents) {
        // Skip if this agent already has an invocation in flight
        if (running.has(agent.id)) continue;

        // Poll with per-agent cursor, excluding events from self
        const allEvents = pollEvents(db, agent.id, 100, agent.id);
        const matched = filterMatchedEvents(allEvents, agent);
        if (matched.length === 0) continue;

        console.log(
          `[${agent.id}] dispatching ${matched.length} event(s): ${
            matched.map((e) => e.type).join(", ")
          }`,
        );

        running.add(agent.id);
        invokeAgent(agent, matched, dbPath, projectRoot)
          .then(({ success, output }) => {
            console.log(formatAgentOutput(agent.id, success, output));
          })
          .catch((err) => {
            console.error(`[${agent.id}] error: ${err}`);
          })
          .finally(() => {
            running.delete(agent.id);
          });
      }

      await sleep(config.pollIntervalMs);
    }
  } finally {
    db.close();
  }
};
