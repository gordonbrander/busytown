/**
 * File system watcher that pushes FS change events to the SQLite event queue.
 *
 * Uses Deno.watchFs() to monitor directories for file creates, modifications,
 * and deletes. Events are filtered through exclude patterns before being pushed
 * to the shared event queue.
 *
 * @module fs-watcher
 */

import { relative, resolve } from "node:path";
import { globToRegExp } from "@std/path";
import { debounce } from "@std/async/debounce";
import { pushEvent } from "./event-queue.ts";
import mainLogger from "./main-logger.ts";
import { DatabaseSync } from "node:sqlite";

const logger = mainLogger.child({ component: "fs-watcher" });

export type FsWatcherConfig = {
  db: DatabaseSync;
  watchPaths: string[];
  excludePaths: string[];
  agentCwd: string;
  abortSignal: AbortSignal;
};

export const DEFAULT_EXCLUDES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.DS_Store",
  "*.pid",
  "*.log",
  "events.db*",
];

/** Compile an array of glob patterns into RegExp objects for matching. */
export function compileExcludes(patterns: string[]): RegExp[] {
  return patterns.map((p) =>
    globToRegExp(p, { extended: true, globstar: true })
  );
}

/** Check whether a relative path should be excluded based on compiled patterns. */
export function shouldExclude(relPath: string, compiled: RegExp[]): boolean {
  return compiled.some((re) => re.test(relPath));
}

/** Map Deno.FsEvent kind to our event type, or undefined if we should skip it. */
const mapEventKind = (
  kind: Deno.FsEvent["kind"],
): string | undefined => {
  switch (kind) {
    case "create":
      return "file.created";
    case "modify":
      return "file.modified";
    case "remove":
      return "file.deleted";
    default:
      return undefined;
  }
};

/**
 * Run the file system watcher.
 *
 * Opens its own DB connection, watches the configured paths recursively,
 * and pushes events to the queue. Runs indefinitely.
 */
export const runFsWatcher = async (config: FsWatcherConfig): Promise<void> => {
  const db = config.db;
  const projectRoot = resolve(config.agentCwd ?? Deno.cwd());
  const watchPaths = config.watchPaths.map((p) => resolve(projectRoot, p));

  const allExcludes = [
    ...DEFAULT_EXCLUDES,
    ...config.excludePaths,
  ];
  const compiled = compileExcludes(allExcludes);

  logger.info("Watcher starting", {
    paths: watchPaths,
    excludes: allExcludes,
  });

  const processEvent = debounce((event: Deno.FsEvent): void => {
    const eventType = mapEventKind(event.kind);
    if (eventType == undefined) return;

    for (const absPath of event.paths) {
      const relPath = relative(projectRoot, absPath);
      if (shouldExclude(relPath, compiled)) continue;
      pushEvent(db, "fs", eventType, { path: relPath });
    }
  }, 200);

  const watcher = Deno.watchFs(watchPaths, { recursive: true });

  config.abortSignal.addEventListener("abort", () => {
    watcher.close();
    processEvent.clear();
  });

  try {
    for await (const event of watcher) {
      processEvent(event);
    }
  } finally {
    processEvent.clear();
    watcher.close();
  }
};
