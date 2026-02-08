/**
 * File system watcher that pushes FS change events to the SQLite event queue.
 *
 * Uses Deno.watchFs() to monitor directories for file creates, modifications,
 * and deletes. Events are debounced and filtered through ignore patterns before
 * being pushed to the shared event queue.
 *
 * @module fs-watcher
 */

import { relative, resolve } from "node:path";
import { openDb, pushEvent } from "./event-queue.ts";
import mainLogger from "./main-logger.ts";
import type { DatabaseSync } from "node:sqlite";

const logger = mainLogger.child({ module: "fs-watcher" });

export type FsWatcherConfig = {
  watchPaths: string[];
  ignorePatterns: string[];
  debounceMs: number;
  dbPath: string;
  projectRoot: string;
};

/** Exact-match patterns: any path segment matching one of these is ignored. */
export const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  ".DS_Store",
  ".agent-runner.pid",
  ".agent-runner.log",
  "logs",
];

/** Prefix-match patterns: if the basename starts with one of these, it's ignored. */
export const DEFAULT_IGNORE_PREFIXES = [
  "events.db",
];

/**
 * Check whether a relative path should be ignored.
 *
 * A path is ignored if:
 * - Any segment exactly matches an entry in `patterns`, OR
 * - The basename starts with any entry in `prefixes`
 */
export const shouldIgnore = (
  relPath: string,
  patterns: string[] = DEFAULT_IGNORE_PATTERNS,
  prefixes: string[] = DEFAULT_IGNORE_PREFIXES,
): boolean => {
  const segments = relPath.split("/");
  for (const segment of segments) {
    if (patterns.includes(segment)) return true;
  }
  const basename = segments[segments.length - 1];
  for (const prefix of prefixes) {
    if (basename.startsWith(prefix)) return true;
  }
  return false;
};

/** Map Deno.FsEvent kind to our event type, or null if we should skip it. */
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
 * Creates a debounced event pusher.
 *
 * Rapid FS events for the same path+type are coalesced: only the last event
 * in a burst (within `debounceMs`) fires.
 */
export const createDebouncer = (
  db: DatabaseSync,
  _projectRoot: string,
  debounceMs: number,
) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return (eventType: string, relPath: string) => {
    const key = `${eventType}:${relPath}`;
    const existing = timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        pushEvent(db, "fs-watcher", eventType, { path: relPath });
        logger.debug("Event pushed", { type: eventType, path: relPath });
      }, debounceMs),
    );
  };
};

/**
 * Run the file system watcher.
 *
 * Opens its own DB connection, watches the configured paths recursively,
 * and pushes debounced events to the queue. Runs indefinitely.
 */
export const runFsWatcher = async (config: FsWatcherConfig): Promise<void> => {
  const projectRoot = resolve(config.projectRoot);
  const dbPath = resolve(config.dbPath);
  const watchPaths = config.watchPaths.map((p) => resolve(projectRoot, p));

  const db = openDb(dbPath);
  const debounce = createDebouncer(db, projectRoot, config.debounceMs);

  const allIgnorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...config.ignorePatterns,
  ];

  logger.info("Watcher starting", {
    paths: watchPaths,
    debounce_ms: config.debounceMs,
    ignore_patterns: allIgnorePatterns,
  });

  try {
    const watcher = Deno.watchFs(watchPaths, { recursive: true });
    for await (const event of watcher) {
      const eventType = mapEventKind(event.kind);
      if (eventType == undefined) continue;

      for (const absPath of event.paths) {
        const relPath = relative(projectRoot, absPath);
        if (shouldIgnore(relPath, allIgnorePatterns, DEFAULT_IGNORE_PREFIXES)) {
          continue;
        }
        debounce(eventType, relPath);
      }
    }
  } finally {
    db.close();
  }
};
