import { DatabaseSync } from "node:sqlite";
import {
  getNextEvent,
  getOrCreateCursor,
  updateCursor,
} from "./event-queue.ts";
import { type Event, eventMatches } from "./event.ts";
import { abortableSleep, nextTick } from "./utils.ts";
import mainLogger from "./main-logger.ts";

export type EffectContext = {
  abortSignal: AbortSignal;
};

export type Effect = (event: Event, context: EffectContext) => Promise<void>;

export type Worker = {
  id: string;
  listen: string[];
  run: Effect;
};

export type Awaitable<T> = Promise<T> | T;

export const worker = ({
  id,
  listen,
  run,
}: {
  id: string;
  listen: string[];
  run: (event: Event, context: EffectContext) => Awaitable<void>;
}): Worker => ({
  id,
  listen,
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

const logger = mainLogger.child({ source: "runner" });

export const createSystem = (
  db: DatabaseSync,
  timeout = 1000,
): WorkerSystem => {
  const systemAbortController = new AbortController();
  // Live worker forks
  const workers: Map<string, WorkerHandle> = new Map();
  // In-flight effects
  const runningEffects: Set<Promise<void>> = new Set();

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

  const manageEffect = (
    worker: Worker,
    event: Event,
    abortSignal: AbortSignal,
  ): Promise<void> => {
    logger.debug("Effect start", { workerId: worker.id });
    const promise = runEffect(worker, event, abortSignal).then(() => {
      runningEffects.delete(promise);
      logger.debug("Effect finish", { workerId: worker.id });
    }).catch((error) => {
      runningEffects.delete(promise);
      logger.error("Effect error", { workerId: worker.id, error });
    });
    runningEffects.add(promise);
    return promise;
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
      // We deliver at most once and fan out worker instances.
      updateCursor(db, worker.id, event.id);

      if (eventMatches(event, worker.listen)) {
        logger.debug("Dispatching event", {
          workerId: worker.id,
          workerListen: worker.listen,
          event,
        });
        manageEffect(worker, event, abortSignal);
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
