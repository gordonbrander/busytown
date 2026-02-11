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
import { z } from "zod/v4";
import { extractYaml } from "@std/front-matter";
import { basename, join, resolve } from "node:path";
import type { Event } from "./event.ts";
import { eventMatches } from "./event.ts";
import { openDb, pushEvent } from "./event-queue.ts";
import { type FsEvent, type FsEventType, watchFs } from "./fs-watcher.ts";
import mainLogger from "./main-logger.ts";
import { pipeStreamToFile } from "./stream.ts";
import { renderTemplate } from "./template.ts";
import { createWorkerSystem, worker } from "./worker.ts";
import { forever } from "./utils.ts";

const logger = mainLogger.child({ component: "runner" });

/**
 * Validates YAML frontmatter attributes from agent markdown files.
 * Currently describes the union of all properties for all agent types.
 * Later, we disambiguate this into a discriminated union when constructing the
 * agent def.
 */
const AgentFrontmatterSchema = z.object({
  type: z.enum(["claude", "shell"]).default("claude"),
  description: z.string().default(""),
  listen: z.array(z.string()).default([]),
  allowed_tools: z.array(z.string()).default([]),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

export const ClaudeAgentDefSchema = z.object({
  id: z.string(),
  type: z.literal("claude"),
  description: z.string().default(""),
  listen: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  body: z.string().default("").describe("The agent system prompt"),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
});

export type ClaudeAgentDef = z.infer<typeof ClaudeAgentDefSchema>;

export const ShellAgentDefSchema = z.object({
  id: z.string(),
  type: z.literal("shell"),
  description: z.string().default(""),
  listen: z.array(z.string()).default([]),
  body: z.string().describe("The script to run"),
});

export type ShellAgentDef = z.infer<typeof ShellAgentDefSchema>;

export const AgentDefSchema = z.union([
  ClaudeAgentDefSchema,
  ShellAgentDefSchema,
]);

export type AgentDef = z.infer<typeof AgentDefSchema>;

export type RunnerConfig = {
  agentsDir: string;
  dbPath: string;
  pollIntervalMs: number;
  agentCwd: string;
  watchPaths: string[];
  excludePaths: string[];
};

/** Load a single agent definition from a markdown file with YAML frontmatter. */
export const loadAgentDef = async (filePath: string): Promise<AgentDef> => {
  const raw = await Deno.readTextFile(filePath);
  const { attrs, body } = extractYaml(raw);
  const frontmatter = AgentFrontmatterSchema.parse(attrs);
  switch (frontmatter.type) {
    case "claude":
      return {
        id: basename(filePath, ".md"),
        type: "claude",
        description: frontmatter.description,
        listen: frontmatter.listen,
        allowedTools: frontmatter.allowed_tools,
        body: body.trim(),
        model: frontmatter.model,
        effort: frontmatter.effort,
      };
    case "shell":
      return {
        id: basename(filePath, ".md"),
        type: frontmatter.type,
        description: frontmatter.description,
        listen: frontmatter.listen,
        body,
      };
    default:
      // Never should happen
      throw new Error(`Unsupported agent type: ${frontmatter.type}`);
  }
};

/** Load all agent definitions from a directory. */
export async function* loadAllAgents(
  agentsDir: string,
): AsyncGenerator<AgentDef> {
  try {
    for await (const entry of Deno.readDir(agentsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      try {
        yield await loadAgentDef(join(agentsDir, entry.name));
      } catch (err) {
        logger.error("Failed to load agent", { file: entry.name, error: err });
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      logger.warn("Agents directory not found", { agentsDir });
      return;
    }
    throw err;
  }
}

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

  const stdoutPipe = pipeStreamToFile(process.stdout, logFile);
  const stderrPipe = pipeStreamToFile(process.stderr, logFile);

  const { code } = await process.status;
  await Promise.all([stdoutPipe, stderrPipe]);
  logFile.close();

  return code;
};

/** Invoke a shell agent by rendering its template and running via sh -c. */
export const runShellAgent = async (
  agent: ShellAgentDef,
  event: Event,
  projectRoot: string,
): Promise<number> => {
  const context = { event };
  const command = renderTemplate(agent.body, context);

  const logsDir = join(projectRoot, "logs");
  await Deno.mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `${agent.id}.log`);
  const logFile = await Deno.open(logPath, {
    write: true,
    create: true,
    append: true,
  });

  const cmd = new Deno.Command("sh", {
    args: ["-c", command],
    cwd: projectRoot,
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();

  const stdoutPipe = pipeStreamToFile(process.stdout, logFile);
  const stderrPipe = pipeStreamToFile(process.stderr, logFile);

  const { code } = await process.status;
  await Promise.all([stdoutPipe, stderrPipe]);
  logFile.close();

  return code;
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
  logger.info("Starting", {
    db: dbPath,
    interval_ms: pollIntervalMs,
  });

  const db = openDb(dbPath);
  const projectRoot = resolve(agentCwd ?? Deno.cwd());
  const agents = await Array.fromAsync(loadAllAgents(agentsDir));

  const system = createWorkerSystem({ db, timeout: pollIntervalMs });

  // Spawn stdout event worker
  system.spawn(
    worker("_stdout", (event) => {
      console.log(JSON.stringify(event));
    }),
  );

  // Agent workers
  for (const agent of agents) {
    system.spawn(
      worker(agent.id, async (event) => {
        if (!eventMatches(event, agent.listen)) {
          return;
        }

        switch (agent.type) {
          case "shell":
            await runShellAgent(agent, event, projectRoot);
            return;
          case "claude":
            await runClaudeAgent(agent, event, dbPath, projectRoot);
            return;
          default:
            throw new Error(`Unknown agent type`);
        }
      }),
    );
  }

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

  Deno.addSignalListener("SIGTERM", async () => {
    await system.stop();
    stopWatchFs();
    db.close();
    Deno.exit(0);
  });

  await forever();
};
