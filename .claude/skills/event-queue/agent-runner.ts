#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
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

import { extract } from "jsr:@std/front-matter@^1.0/yaml";
import { parseArgs } from "node:util";
import { basename, join, resolve } from "node:path";
import { type Event, openDb, pollEvents } from "./event-queue.ts";

export type AgentDef = {
  id: string;
  description: string;
  listen: string[];
  systemPrompt: string;
  filePath: string;
};

export type RunnerConfig = {
  agentsDir: string;
  dbPath: string;
  pollIntervalMs: number;
  agentFilter?: string;
};

/** Load a single agent definition from a markdown file with YAML frontmatter. */
export const loadAgentDef = async (filePath: string): Promise<AgentDef> => {
  const raw = await Deno.readTextFile(filePath);
  const { attrs, body } = extract(raw) as {
    attrs: Record<string, unknown>;
    body: string;
  };
  const id = basename(filePath, ".md");
  const description = (attrs.description as string) ?? "";
  const listen = (attrs.listen as string[]) ?? ["*"];
  return { id, description, listen, systemPrompt: body.trim(), filePath };
};

/** Load all agent definitions from a directory, optionally filtering to one. */
export const loadAllAgents = async (
  agentsDir: string,
  agentFilter?: string,
): Promise<AgentDef[]> => {
  const agents: AgentDef[] = [];
  for await (const entry of Deno.readDir(agentsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    if (agentFilter && basename(entry.name, ".md") !== agentFilter) continue;
    agents.push(await loadAgentDef(join(agentsDir, entry.name)));
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
  eventQueuePath: string,
): string => {
  const header = `You are the "${agent.id}" agent. ${agent.description}

## Pushing events

To push events to the queue, run:
  ${eventQueuePath} push --worker ${agent.id} --db ${dbPath} --data '<json>'

where <json> is a JSON object with "type" and optional "payload" fields.

---

`;
  return header + agent.systemPrompt;
};

/** Invoke an agent as a headless Claude Code instance. */
export const invokeAgent = async (
  agent: AgentDef,
  events: Event[],
  dbPath: string,
  eventQueuePath: string,
): Promise<{ success: boolean; output: string }> => {
  const systemPrompt = buildSystemPrompt(agent, dbPath, eventQueuePath);
  const userMessage = formatEventsForPrompt(events);

  const cmd = new Deno.Command("claude", {
    args: [
      "--print",
      "--system-prompt",
      systemPrompt,
      "--output-format",
      "text",
    ],
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

/** Promise-based sleep utility. */
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Main poll loop: loads agents, polls events, dispatches to matching agents. */
export const runPollLoop = async (config: RunnerConfig): Promise<void> => {
  const agentsDir = resolve(config.agentsDir);
  const dbPath = resolve(config.dbPath);
  const eventQueuePath = resolve(
    import.meta.dirname ?? ".",
    "event-queue.ts",
  );

  console.log(`Loading agents from ${agentsDir}...`);
  const agents = await loadAllAgents(agentsDir, config.agentFilter);
  if (agents.length === 0) {
    console.error("No agents found.");
    Deno.exit(1);
  }
  for (const a of agents) {
    console.log(`  ${a.id} — listens: [${a.listen.join(", ")}]`);
  }

  const db = openDb(dbPath);
  const running = new Set<string>();

  console.log(`Polling ${dbPath} every ${config.pollIntervalMs}ms...\n`);

  try {
    while (true) {
      for (const agent of agents) {
        // Skip if this agent already has an invocation in flight
        if (running.has(agent.id)) continue;

        // Poll with per-agent cursor, excluding events from self
        const allEvents = pollEvents(db, agent.id, 100, agent.id);
        if (allEvents.length === 0) continue;

        // Filter to only events matching this agent's listen patterns
        const matched = allEvents.filter((e) => matchesListen(e, agent));
        if (matched.length === 0) continue;

        console.log(
          `[${agent.id}] dispatching ${matched.length} event(s): ${
            matched.map((e) => e.type).join(", ")
          }`,
        );

        running.add(agent.id);
        invokeAgent(agent, matched, dbPath, eventQueuePath)
          .then(({ success, output }) => {
            const status = success ? "completed" : "failed";
            console.log(`[${agent.id}] ${status}`);
            if (output.trim()) {
              console.log(
                output
                  .trim()
                  .split("\n")
                  .map((l) => `  ${l}`)
                  .join("\n"),
              );
            }
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

  if (command !== "run") {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    Deno.exit(1);
  }

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
