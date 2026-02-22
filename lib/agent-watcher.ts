/**
 * Watches the agents directory for `.md` file changes and hot-reloads agent
 * workers by killing the old worker and spawning a new one.
 *
 * Follows the same pattern as `fs-watcher.ts` — uses `Deno.watchFs`,
 * debounces, and returns a `Cleanup` function.
 *
 * @module agent-watcher
 */

import { debounce } from "@std/async/debounce";
import type { DatabaseSync } from "node:sqlite";
import { pushEvent } from "./event-queue.ts";
import { type AgentDef, loadAgentDef } from "./runner.ts";
import { pathToSlug } from "./slug.ts";
import type { Worker, WorkerSystem } from "./worker.ts";
import type { Cleanup } from "./fs-watcher.ts";

export type AgentChangeKind = "create" | "modify" | "remove";

export type AgentChange = {
  path: string;
  kind: AgentChangeKind;
};

/** Collapse a sequence of FS event kinds into a single agent change kind. */
export const collapseKind = (
  kinds: Set<Deno.FsEvent["kind"]>,
): AgentChangeKind => {
  // If the last thing that happened was a remove and there was no subsequent
  // create/modify, treat as remove.
  if (kinds.has("remove") && !kinds.has("create") && !kinds.has("modify")) {
    return "remove";
  }
  // If there's a create (and possibly modify), it's a new file.
  if (kinds.has("create")) return "create";
  // Otherwise it's a modification (modify, rename, etc.)
  return "modify";
};

export type WatchAgentsOptions = {
  agentsDir: string;
  system: WorkerSystem;
  db: DatabaseSync;
  toWorker: (agent: AgentDef) => Worker;
  /** Set of agent IDs already spawned at startup. Used to distinguish
   *  create vs reload. If not provided, all changes are treated as reloads. */
  knownAgentIds?: Set<string>;
  /** Debounce interval in ms. Defaults to 300. */
  debounceMs?: number;
};

/**
 * Watch the agents directory for `.md` file changes and hot-reload workers.
 * Returns a cleanup function that stops the watcher.
 */
export const watchAgents = ({
  agentsDir,
  system,
  db,
  toWorker,
  knownAgentIds = new Set(),
  debounceMs = 300,
}: WatchAgentsOptions): Cleanup => {
  // Accumulated FS events, flushed on debounce
  const pending = new Map<string, Set<Deno.FsEvent["kind"]>>();

  const removeAgent = async (id: string, path: string): Promise<void> => {
    const killed = await system.kill(id);
    if (killed) {
      knownAgentIds.delete(id);
      pushEvent(db, "sys", "sys.agent.remove", { agent_id: id, path });
    }
  };

  const flush = async () => {
    const batch = new Map(pending);
    pending.clear();

    for (const [path, kinds] of batch) {
      const id = pathToSlug(path);
      if (!id) continue;

      const changeKind = collapseKind(kinds);

      if (changeKind === "remove") {
        await removeAgent(id, path);
        continue;
      }

      // create or modify — (re)load the agent def
      let agentDef: AgentDef;
      try {
        agentDef = await loadAgentDef(path);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          // File was renamed away between event and flush — treat as remove
          await removeAgent(id, path);
          continue;
        }
        // Bad YAML or other parse error — emit error, don't crash
        pushEvent(db, "sys", "sys.agent.error", {
          agent_id: id,
          path,
          error: String(err),
        });
        continue;
      }

      // Kill existing worker (no-op if it doesn't exist)
      await system.kill(id);

      // Spawn fresh worker
      system.spawn(toWorker(agentDef));

      const isNew = !knownAgentIds.has(id);
      knownAgentIds.add(id);

      if (isNew) {
        pushEvent(db, "sys", "sys.agent.create", { agent_id: id, path });
      } else {
        pushEvent(db, "sys", "sys.agent.reload", { agent_id: id, path });
      }
    }
  };

  const debouncedFlush = debounce(flush, debounceMs);
  const watcher = Deno.watchFs(agentsDir, { recursive: false });

  const cleanup = async (): Promise<void> => {
    watcher.close();
    debouncedFlush.clear();
    await Promise.resolve();
  };

  const forkWatcher = async () => {
    try {
      for await (const event of watcher) {
        for (const path of event.paths) {
          if (!path.endsWith(".md")) continue;

          const existing = pending.get(path);
          if (existing) {
            existing.add(event.kind);
          } else {
            pending.set(path, new Set([event.kind]));
          }
        }

        if (pending.size > 0) {
          debouncedFlush();
        }
      }
    } finally {
      await cleanup();
    }
  };

  forkWatcher();

  return cleanup;
};
