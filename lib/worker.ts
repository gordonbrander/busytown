import { scheduler } from "node:timers/promises";
import { type DatabaseSync } from "node:sqlite";
import {
  getNextEvent,
  getOrCreateCursor,
  updateCursor,
} from "./event-queue.ts";
import { type Event } from "./event.ts";
import mainLogger from "./main-logger.ts";
import { sleep } from "./utils.ts";

export type Worker = {
  id: string;
  next: (event: Event) => Promise<void>;
};

/** Create a worker. */
export const worker = (
  id: string,
  next: (event: Event) => Promise<void>,
): Worker => ({
  id,
  next,
});

type WorkerTask = {
  worker: Worker;
  promise: Promise<void>;
};

export type WorkerSystem = {
  spawn: (worker: Worker) => void;
  kill: (id: string) => Promise<boolean>;
};

const systemLogger = mainLogger.child({ subcomponent: "worker-system" });

export const createWorkerSystem = ({
  db,
  timeout = 1000,
}: {
  db: DatabaseSync;
  timeout: number;
}): WorkerSystem => {
  const tasks = new Map<string, WorkerTask>();

  /** Spawn worker. Starts worker immediately. */
  const spawn = (worker: Worker): void => {
    if (tasks.has(worker.id)) {
      systemLogger.error(`Worker already exists`, { workerId: worker.id });
      throw new Error(`Worker already exists: ${worker.id}`);
    }
    const task: WorkerTask = { worker, promise: Promise.resolve() };
    tasks.set(worker.id, task);
    task.promise = fork(worker.id);
  };

  /** Kill worker. Awaits in-flight work before resolving. */
  const kill = async (id: string): Promise<boolean> => {
    const task = tasks.get(id);
    if (!task) {
      systemLogger.debug(`Can't kill worker. Worker does not exist.`, {
        workerId: id,
      });
      return false;
    }
    // Signal the loop to stop, then wait for in-flight work to finish
    tasks.delete(id);
    await task.promise;
    systemLogger.debug(`Killed worker`, { workerId: id });
    return true;
  };

  /** Safely process next event */
  const next = async (worker: Worker, event: Event): Promise<boolean> => {
    try {
      await worker.next(event);
      return true;
    } catch (error) {
      systemLogger.error(`Worker error`, { workerId: worker.id, error });
      return false;
    }
  };

  /** Run worker as long as it is registered */
  const fork = async (id: string): Promise<void> => {
    while (true) {
      // Hot load worker
      const task = tasks.get(id);
      // If worker has been removed, nothing to do.
      if (!task) return;
      const { worker } = task;

      const sinceId = getOrCreateCursor(db, worker.id);

      // Get next event
      const event = getNextEvent(db, sinceId);

      // If no event, sleep and try again later.
      if (!event) {
        await sleep(timeout);
        continue;
      }

      // Perform work
      await next(worker, event);

      // Advance cursor whether or not the work was successful
      updateCursor(db, worker.id, event.id);

      // This could be a hot loop, so yield to the scheduler to prevent
      // starving other tasks.
      await scheduler.yield();
    }
  };

  return {
    spawn,
    kill,
  };
};
