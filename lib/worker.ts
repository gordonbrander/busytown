import { scheduler } from "node:timers/promises";
import { type DatabaseSync } from "node:sqlite";
import {
  getEventsSince,
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

export type WorkerSystem = {
  spawn: (worker: Worker) => void;
  kill: (id: string) => boolean;
};

const systemLogger = mainLogger.child({ subcomponent: "worker-system" });

export const createWorkerSystem = ({
  db,
  timeout = 1000,
}: {
  db: DatabaseSync;
  timeout: number;
}): WorkerSystem => {
  const workers = new Map<string, Worker>();

  /** Spawn worker. Starts worker immediately */
  const spawn = (worker: Worker): void => {
    if (workers.has(worker.id)) {
      systemLogger.error(`Worker already exists`, { workerId: worker.id });
      throw new Error(`Worker already exists: ${worker.id}`);
    }
    workers.set(worker.id, worker);
    fork(worker.id);
  };

  /** Kill worker */
  const kill = (id: string): boolean => {
    const worker = workers.get(id);
    if (!worker) {
      systemLogger.debug(`Can't kill worker. Worker does not exist.`, {
        workerId: id,
      });
      return false;
    }
    workers.delete(id);
    systemLogger.debug(`Killed worker`, {
      workerId: id,
    });
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
      const worker = workers.get(id);
      // If worker has been removed, nothing to do.
      if (!worker) return;

      const sinceId = getOrCreateCursor(db, worker.id);

      // Get next event
      const event = getEventsSince(db, { sinceId, limit: 1 }).at(0);

      // If no event, sleep and try again later.
      if (!event) {
        await sleep(timeout);
        continue;
      }

      await next(worker, event);

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
