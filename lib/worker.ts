import { scheduler } from "node:timers/promises";
import { type DatabaseSync } from "node:sqlite";
import {
  getNextEvent,
  getOrCreateCursor,
  updateCursor,
} from "./event-queue.ts";
import { type Event, eventMatches } from "./event.ts";
import mainLogger from "./main-logger.ts";
import { sleep } from "./utils.ts";

export type Worker = {
  id: string;
  listen: string[];
  next: (event: Event) => Promise<void>;
};

export type Awaitable<T> = Promise<T> | T;

/** Create a worker. */
export const worker = (
  {
    id,
    listen,
    next,
  }: {
    id: string;
    listen: string[];
    next: (event: Event) => Awaitable<void>;
  },
): Worker => ({
  id,
  listen,
  next: async (event: Event): Promise<void> => await next(event),
});

type WorkerTask = {
  worker: Worker;
  promise: Promise<void>;
};

export type WorkerSystem = {
  spawn: (worker: Worker) => void;
  kill: (id: string) => Promise<boolean>;
  stop: () => Promise<void>;
};

const systemLogger = mainLogger.child({ source: "worker-system" });

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
      systemLogger.error(`Worker exists`, { workerId: worker.id });
      throw new Error(`Worker exists: ${worker.id}`);
    }
    systemLogger.error(`Spawning worker`, { workerId: worker.id });
    tasks.set(worker.id, { worker, promise: fork(worker.id) });
  };

  /** Kill worker. Awaits in-flight work before resolving. */
  const kill = async (id: string): Promise<boolean> => {
    systemLogger.error(`Killing worker`, { workerId: id });
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

  /** Run worker as long as it is registered */
  const fork = async (id: string): Promise<void> => {
    await scheduler.yield();

    while (true) {
      // Hot load worker
      const task = tasks.get(id);
      // If worker has been removed, nothing to do.
      if (!task) {
        systemLogger.debug("Worker removed. Exiting task.", {
          workerId: id,
        });
        return;
      }
      const { worker } = task;

      const sinceId = getOrCreateCursor(db, worker.id);

      // Get next event
      const event = getNextEvent(db, sinceId);

      // If no event, sleep and try again later.
      if (!event) {
        await sleep(timeout);
        continue;
      }

      if (eventMatches(event, worker.listen)) {
        systemLogger.debug("Worker start", {
          workerId: worker.id,
          workerListen: worker.listen,
          eventId: event.id,
        });
        try {
          await worker.next(event);
          systemLogger.debug("Worker finish", {
            workerId: worker.id,
            workerListen: worker.listen,
            eventId: event.id,
          });
        } catch (error) {
          systemLogger.error(`Worker error`, { worker_id: worker.id, error });
        }
      }

      // Advance cursor either way
      updateCursor(db, worker.id, event.id);

      // This could be a hot loop, so yield to the scheduler to prevent
      // starving other tasks.
      await scheduler.yield();
    }
  };

  /** Stop all workers. Awaits in-flight work before resolving. */
  const stop = async (): Promise<void> => {
    await Promise.all([...tasks.keys()].map(kill));
  };

  return {
    spawn,
    kill,
    stop,
  };
};
