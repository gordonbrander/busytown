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
import { resolve } from "node:path";
import type { Event } from "./event.ts";
import { openDb, pipeStreamToEvents, pushEvent } from "./event-queue.ts";
import { type FsEvent, type FsEventType, watchFs } from "./fs-watcher.ts";
import { DatabaseSync } from "node:sqlite";
import { renderTemplate } from "./template.ts";
import { createSystem, type Worker, worker } from "./worker.ts";
import { forever } from "./utils.ts";
import { watchAgents } from "./agent-watcher.ts";
import {
  type AgentDef,
  type ClaudeAgentDef,
  loadAllAgents,
  type ShellAgentDef,
} from "./agent.ts";

export type RunnerConfig = {
  agentsDir: string;
  dbPath: string;
  pollIntervalMs: number;
  agentCwd: string;
  watchPaths: string[];
  excludePaths: string[];
};

/** Build the full system prompt for an agent invocation. */
export const buildSystemPrompt = (
  agent: ClaudeAgentDef,
  dbPath: string,
): string => {
  return `You are the "${agent.id}" agent. ${agent.description}

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

${agent.body}
`;
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
export const runClaudeAgent = async (
  agent: ClaudeAgentDef,
  event: Event,
  dbPath: string,
  projectRoot: string,
  db: DatabaseSync,
): Promise<number> => {
  const systemPrompt = buildSystemPrompt(agent, dbPath);
  const userMessage = JSON.stringify(event);
  const toolArgs = buildToolArgs(agent.allowedTools);

  const cmd = new Deno.Command("claude", {
    args: [
      "--print",
      "--system-prompt",
      systemPrompt,
      "--verbose",
      "--output-format",
      "stream-json",
      ...toolArgs,
      ...(agent.model ? ["--model", agent.model] : []),
      ...(agent.effort ? ["--effort", agent.effort] : []),
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

  const stdoutPipe = pipeStreamToEvents(
    process.stdout,
    db,
    agent.id,
    `sys.worker.${agent.id}.stdout`,
  );
  const stderrPipe = pipeStreamToEvents(
    process.stderr,
    db,
    agent.id,
    `sys.worker.${agent.id}.stderr`,
  );

  const { code } = await process.status;
  await Promise.all([stdoutPipe, stderrPipe]);

  return code;
};

/** Invoke a shell agent by rendering its template and running via sh -c. */
export const runShellAgent = async (
  agent: ShellAgentDef,
  event: Event,
  projectRoot: string,
  db: DatabaseSync,
): Promise<number> => {
  const context = { event };
  const command = renderTemplate(agent.body, context);

  const cmd = new Deno.Command("sh", {
    args: ["-c", command],
    cwd: projectRoot,
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();

  const stdoutPipe = pipeStreamToEvents(
    process.stdout,
    db,
    agent.id,
    `sys.worker.${agent.id}.stdout`,
  );
  const stderrPipe = pipeStreamToEvents(
    process.stderr,
    db,
    agent.id,
    `sys.worker.${agent.id}.stderr`,
  );

  const { code } = await process.status;
  await Promise.all([stdoutPipe, stderrPipe]);

  return code;
};

/** Create a factory that turns an AgentDef into a Worker. */
export const makeAgentWorker = (
  db: DatabaseSync,
  dbPath: string,
  projectRoot: string,
): ((agent: AgentDef) => Worker) => {
  return (agent) =>
    worker({
      id: agent.id,
      listen: agent.listen,
      ignoreSelf: agent.ignoreSelf,
      run: async (event) => {
        switch (agent.type) {
          case "shell":
            await runShellAgent(agent, event, projectRoot, db);
            return;
          case "claude":
            await runClaudeAgent(agent, event, dbPath, projectRoot, db);
            return;
          default: {
            const _exhaustive: never = agent;
            throw new Error(
              `Unknown agent type: ${(_exhaustive as AgentDef).type}`,
            );
          }
        }
      },
    });
};

export type FsWorkerEventType =
  | "file.create"
  | "file.modify"
  | "file.delete"
  | "file.rename";

/** Map Deno.FsEvent kind to our event type, or undefined if we should skip it. */
export const mapFsEventType = (
  kind: FsEventType,
): FsWorkerEventType | undefined => {
  switch (kind) {
    case "create":
      return "file.create";
    case "modify":
      return "file.modify";
    case "remove":
      return "file.delete";
    case "rename":
      return "file.rename";
    default:
      return undefined;
  }
};

/** Main poll loop: loads agents, polls events, dispatches to matching agents. */
export const runMain = async (
  {
    dbPath,
    agentCwd,
    agentsDir,
    pollIntervalMs,
    watchPaths,
    excludePaths,
  }: RunnerConfig,
): Promise<void> => {
  const db = openDb(dbPath);
  const projectRoot = resolve(agentCwd ?? Deno.cwd());
  const agents = await Array.fromAsync(loadAllAgents(agentsDir));
  const system = createSystem(db, pollIntervalMs);

  // Spawn stdout event worker
  system.spawn(
    worker({
      id: "_stdout",
      hidden: true,
      listen: ["*"],
      run: (event) => {
        console.log(JSON.stringify(event));
      },
    }),
  );

  // Agent workers
  const toWorker = makeAgentWorker(db, dbPath, projectRoot);
  for (const agent of agents) {
    system.spawn(toWorker(agent));
  }

  const stopWatchAgents = watchAgents({
    agentsDir,
    system,
    db,
    toWorker,
    knownAgentIds: new Set(agents.map((a) => a.id)),
  });

  const stopWatchFs = watchFs({
    cwd: projectRoot,
    paths: watchPaths,
    excludePaths,
    callback: (event: FsEvent) => {
      const type = mapFsEventType(event.type);
      if (type) {
        pushEvent(db, "fs", type, { paths: event.paths });
      }
    },
  });

  const shutdown = async () => {
    pushEvent(db, "sys", "sys.lifecycle.finish");
    await stopWatchAgents();
    await system.stop();
    await stopWatchFs();
    db.close();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGTERM", shutdown);
  Deno.addSignalListener("SIGINT", shutdown);

  pushEvent(db, "sys", "sys.lifecycle.start");
  await forever();
};
