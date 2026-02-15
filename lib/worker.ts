import { DatabaseSync } from "node:sqlite";
import * as Result from "@gordonb/result/result";
import {
  getNextEvent,
  getOrCreateCursor,
  pushEvent,
  updateCursor,
} from "./event-queue.ts";
import { type Event, eventMatches } from "./event.ts";
import { abortableSleep, nextTick } from "./utils.ts";
export type EffectContext = {
  abortSignal: AbortSignal;
};

export type Effect = (event: Event, context: EffectContext) => Promise<void>;

export type Worker = {
  id: string;
  listen: string[];
  hidden: boolean;
  ignoreSelf: boolean;
  run: Effect;
};

export type Awaitable<T> = Promise<T> | T;

export const worker = ({
  id,
  listen,
  hidden = false,
  ignoreSelf = true,
  run,
}: {
  id: string;
  hidden?: boolean;
  ignoreSelf?: boolean;
  listen: string[];
  run: (event: Event, context: EffectContext) => Awaitable<void>;
}): Worker => ({
  id,
  listen,
  hidden,
  ignoreSelf,
  run: async (
    event: Event,
    context: EffectContext,
  ) => await run(event, context),
});

export type WorkerHandle = {
  worker: Worker;
  fork: Promise<void>;
  abortController: AbortController;
};

export type WorkerSystem = {
  spawn: (worker: Worker) => string;
  kill: (id: string) => Promise<boolean>;
  stop: () => Promise<void>;
};

export const createSystem = (
  db: DatabaseSync,
  timeout = 1000,
): WorkerSystem => {
  const systemAbortController = new AbortController();
  // Live worker forks
  const workers: Map<string, WorkerHandle> = new Map();
  // In-flight effects
  const runningEffects: Set<Promise<Result.Result<void, Error>>> = new Set();

  const runEffect = async (
    worker: Worker,
    event: Event,
    abortSignal: AbortSignal,
  ): Promise<void> => {
    if (abortSignal.aborted) {
      throw new Error(`Worker aborted: ${worker.id}`);
    }

    await worker.run(
      event,
      { abortSignal },
    );
  };

  const manageEffect = async (
    worker: Worker,
    event: Event,
    abortSignal: AbortSignal,
  ): Promise<void> => {
    if (!worker.hidden) {
      pushEvent(db, worker.id, `sys.worker.${worker.id}.start`, {
        event_id: event.id,
        event_type: event.type,
        worker_listen: worker.listen,
      });
    }

    // Get promise for eventual result of effect and track it.
    const effectResultPromise = Result.performAsync<void, Error>(async () => {
      return await runEffect(worker, event, abortSignal);
    });
    runningEffects.add(effectResultPromise);

    const res = await effectResultPromise;
    runningEffects.delete(effectResultPromise);

    if (!res.ok) {
      if (!worker.hidden) {
        pushEvent(db, worker.id, `sys.worker.${worker.id}.error`, {
          event_id: event.id,
          error: `${res.error}`,
        });
      }
    } else {
      if (!worker.hidden) {
        pushEvent(db, worker.id, `sys.worker.${worker.id}.finish`, {
          event_id: event.id,
        });
      }
    }
  };

  const forkWorker = async (
    worker: Worker,
    abortSignal: AbortSignal,
  ): Promise<void> => {
    while (!abortSignal.aborted) {
      const sinceId = getOrCreateCursor(db, worker.id);
      const event = getNextEvent(db, sinceId);

      // No event? Check again in `timeout` ms.
      if (!event) {
        await abortableSleep(timeout, abortSignal);
        continue;
      }

      // Immediately update cursor.
      // We deliver at most once.
      updateCursor(db, worker.id, event.id);

      // Skip events emitted by this worker when ignoreSelf is enabled.
      if (worker.ignoreSelf && event.worker_id === worker.id) {
        await nextTick();
        continue;
      }

      if (eventMatches(event, worker.listen)) {
        await manageEffect(worker, event, abortSignal);
      }

      // This can be a hot loop, so we yield to the event loop.
      await nextTick();
    }
  };

  const spawn = (worker: Worker): string => {
    if (workers.has(worker.id)) {
      throw new Error(`Worker already exists: ${worker.id}`);
    }

    const abortController = new AbortController();
    const process = forkWorker(
      worker,
      AbortSignal.any([
        systemAbortController.signal,
        abortController.signal,
      ]),
    );

    workers.set(worker.id, {
      worker,
      fork: process,
      abortController,
    });

    return worker.id;
  };

  const kill = async (
    id: string,
  ): Promise<boolean> => {
    const worker = workers.get(id);
    if (!worker) return false;
    worker.abortController.abort();
    await worker.fork;
    return workers.delete(id);
  };

  const stop = async (): Promise<void> => {
    systemAbortController.abort();
    // Wait for workers to abort
    await Promise.allSettled(
      Array.from(workers.values().map((worker) => worker.fork)),
    );
    // Wait for in-flight effects to settle
    await Promise.allSettled(Array.from(runningEffects));
  };

  return {
    spawn,
    kill,
    stop,
  };
};
