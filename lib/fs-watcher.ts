/**
 * File system watcher that pushes FS change events to the SQLite event queue.
 *
 * Uses Deno.watchFs() to monitor directories for file creates, modifications,
 * and deletes. Events are filtered through exclude patterns before being pushed
 * to the shared event queue.
 *
 * @module fs-watcher
 */

import { relative } from "node:path";
import { globToRegExp } from "@std/path";
import { debounce } from "@std/async/debounce";
import mainLogger from "./main-logger.ts";

const logger = mainLogger.child({ subcomponent: "fs-watcher" });

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

export type Cleanup = () => Promise<void>;

export type FsEventType = Deno.FsEvent["kind"];

export type FsEvent = {
  type: FsEventType;
  paths: string[];
};

/**
 * Run a file system watcher.
 * File system events are debounced to prevent excessive callbacks.
 */
export const watchFs = ({
  cwd = Deno.cwd(),
  paths,
  excludePaths,
  callback,
}: {
  cwd?: string;
  paths: string[];
  excludePaths: string[];
  callback: (paths: FsEvent) => void;
}): Cleanup => {
  logger.info("Watcher starting", {
    paths,
  });

  const allExcludes = [
    ...DEFAULT_EXCLUDES,
    ...excludePaths,
  ];
  const compiledExcludes = compileExcludes(allExcludes);

  const debouncedCallback = debounce(callback, 200);
  const watcher = Deno.watchFs(paths, { recursive: true });

  const cleanup = async (): Promise<void> => {
    watcher.close();
    debouncedCallback.clear();
    await Promise.resolve();
  };

  const forkWatcher = async () => {
    try {
      for await (const event of watcher) {
        const dedupedEvents = new Set<string>(
          event.paths.filter((absPath): boolean => {
            const relPath = relative(cwd, absPath);
            return !shouldExclude(relPath, compiledExcludes);
          }),
        );

        if (dedupedEvents.size) {
          debouncedCallback({
            type: event.kind,
            paths: Array.from(dedupedEvents),
          });
        }
      }
    } finally {
      await cleanup();
    }
  };

  forkWatcher();

  return cleanup;
};
