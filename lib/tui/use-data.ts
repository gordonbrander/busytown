/**
 * React hooks for polling event queue data.
 * @module tui/use-data
 */

import { useEffect, useRef, useState } from "react";
import type { DatabaseSync } from "node:sqlite";
import type { Event } from "../event.ts";
import { getEventsSince } from "../event-queue.ts";
import type { IndicatorState } from "./format.ts";

/**
 * Poll events from the database and maintain a sliding window.
 */
export const usePollEvents = (
  db: DatabaseSync,
  intervalMs: number,
): Event[] => {
  const [events, setEvents] = useState<Event[]>([]);
  const sinceIdRef = useRef(0);

  useEffect(() => {
    // Initial load - start from tail
    try {
      const stmt = db.prepare("SELECT MAX(id) as maxId FROM events");
      const row = stmt.get() as { maxId: number | null } | undefined;
      if (row?.maxId) {
        sinceIdRef.current = row.maxId;
      }
    } catch (err) {
      console.error("Failed to initialize event cursor:", err);
    }

    const poll = () => {
      try {
        const newEvents = getEventsSince(db, {
          sinceId: sinceIdRef.current,
          limit: 200,
        });
        if (newEvents.length > 0) {
          setEvents((prev) => {
            const updated = [...prev, ...newEvents];
            // Keep only the most recent 500 events
            return updated.slice(-500);
          });
          sinceIdRef.current = newEvents[newEvents.length - 1].id;
        }
      } catch (err) {
        console.error("Failed to poll events:", err);
      }
    };

    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [db, intervalMs]);

  return events;
};

/**
 * Agent state derived from system events.
 */
export interface AgentState {
  id: string;
  state: "idle" | "processing" | "error";
  eventId?: number;
  startedAt?: number;
  indicatorState: IndicatorState;
}

/**
 * Derive agent states from event stream.
 */
export const useAgentStates = (
  events: Event[],
  agentIds: string[],
): Map<string, AgentState> => {
  const [states, setStates] = useState<Map<string, AgentState>>(new Map());
  const pushTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    const newStates = new Map<string, AgentState>();

    // Initialize all agents as idle
    for (const id of agentIds) {
      newStates.set(id, {
        id,
        state: "idle",
        indicatorState: "idle",
      });
    }

    // Process events to update states
    for (const event of events) {
      // Check for start events
      if (event.type.match(/^sys\.worker\.(.+)\.start$/)) {
        const agentId = event.type.replace(/^sys\.worker\./, "").replace(
          /\.start$/,
          "",
        );
        if (agentIds.includes(agentId)) {
          const eventId = typeof event.payload === "object" &&
              event.payload !== null &&
              "event_id" in event.payload
            ? (event.payload as { event_id: number }).event_id
            : undefined;
          newStates.set(agentId, {
            id: agentId,
            state: "processing",
            eventId,
            startedAt: event.timestamp,
            indicatorState: "received", // Will transition to processing
          });
        }
      }

      // Check for finish events
      if (event.type.match(/^sys\.worker\.(.+)\.finish$/)) {
        const agentId = event.type.replace(/^sys\.worker\./, "").replace(
          /\.finish$/,
          "",
        );
        if (agentIds.includes(agentId)) {
          newStates.set(agentId, {
            id: agentId,
            state: "idle",
            indicatorState: "idle",
          });
        }
      }

      // Check for error events
      if (event.type.match(/^sys\.worker\.(.+)\.error$/)) {
        const agentId = event.type.replace(/^sys\.worker\./, "").replace(
          /\.error$/,
          "",
        );
        if (agentIds.includes(agentId)) {
          newStates.set(agentId, {
            id: agentId,
            state: "error",
            indicatorState: "error",
          });
        }
      }

      // Check for push events (non-sys events from agents)
      if (
        agentIds.includes(event.worker_id) &&
        !event.type.startsWith("sys.")
      ) {
        const currentState = newStates.get(event.worker_id);
        if (currentState) {
          // Flash the push indicator
          newStates.set(event.worker_id, {
            ...currentState,
            indicatorState: "pushed",
          });

          // Clear any existing timer
          const existingTimer = pushTimersRef.current.get(event.worker_id);
          if (existingTimer) clearTimeout(existingTimer);

          // Set timer to revert after 300ms
          const timer = setTimeout(() => {
            setStates((prev) => {
              const updated = new Map(prev);
              const state = updated.get(event.worker_id);
              if (state && state.indicatorState === "pushed") {
                updated.set(event.worker_id, {
                  ...state,
                  indicatorState: state.state === "processing"
                    ? "processing"
                    : "idle",
                });
              }
              return updated;
            });
          }, 300);

          pushTimersRef.current.set(event.worker_id, timer);
        }
      }
    }

    setStates(newStates);

    return () => {
      // Clean up timers
      for (const timer of pushTimersRef.current.values()) {
        clearTimeout(timer);
      }
      pushTimersRef.current.clear();
    };
  }, [events, agentIds]);

  // Transition from "received" to "processing" after 200ms
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    for (const [agentId, state] of states) {
      if (state.indicatorState === "received") {
        const timer = setTimeout(() => {
          setStates((prev) => {
            const updated = new Map(prev);
            const s = updated.get(agentId);
            if (s && s.indicatorState === "received") {
              updated.set(agentId, {
                ...s,
                indicatorState: "processing",
              });
            }
            return updated;
          });
        }, 200);
        timers.push(timer);
      }
    }

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [states]);

  return states;
};

/**
 * File event information.
 */
export interface FileEvent {
  op: string;
  path: string;
  timestamp: number;
}

/**
 * Extract file events from the event stream.
 */
export const useFileEvents = (events: Event[]): FileEvent[] => {
  const [fileEvents, setFileEvents] = useState<FileEvent[]>([]);

  useEffect(() => {
    const files: FileEvent[] = [];

    for (const event of events) {
      if (event.type.startsWith("file.")) {
        const op = event.type.replace("file.", "");

        // Check for paths array in payload
        if (
          typeof event.payload === "object" &&
          event.payload !== null &&
          "paths" in event.payload &&
          Array.isArray((event.payload as { paths: unknown }).paths)
        ) {
          const paths = (event.payload as { paths: string[] }).paths;
          for (const path of paths) {
            files.push({ op, path, timestamp: event.timestamp });
          }
        } else if (
          typeof event.payload === "object" &&
          event.payload !== null &&
          "path" in event.payload &&
          typeof (event.payload as { path: unknown }).path === "string"
        ) {
          // Single path
          files.push({
            op,
            path: (event.payload as { path: string }).path,
            timestamp: event.timestamp,
          });
        }
      }
    }

    // Keep only the most recent 20
    setFileEvents(files.slice(-20));
  }, [events]);

  return fileEvents;
};

/**
 * Claim information.
 */
export interface Claim {
  eventId: number;
  workerId: string;
}

/**
 * Query claims for active events.
 */
export const useClaims = (
  db: DatabaseSync,
  activeEventIds: Set<number>,
  intervalMs: number,
): Claim[] => {
  const [claims, setClaims] = useState<Claim[]>([]);

  useEffect(() => {
    const poll = () => {
      if (activeEventIds.size === 0) {
        setClaims([]);
        return;
      }

      try {
        const ids = Array.from(activeEventIds);
        const placeholders = ids.map(() => "?").join(",");
        const sql =
          `SELECT event_id, worker_id FROM claims WHERE event_id IN (${placeholders})`;
        const stmt = db.prepare(sql);
        const rows = stmt.all(...ids) as Array<
          { event_id: number; worker_id: string }
        >;

        setClaims(
          rows.map((r) => ({ eventId: r.event_id, workerId: r.worker_id })),
        );
      } catch (err) {
        console.error("Failed to query claims:", err);
      }
    };

    poll();
    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [db, activeEventIds, intervalMs]);

  return claims;
};

/**
 * Statistics summary.
 */
export interface Stats {
  eventCount: number;
  workerCount: number;
  errorCount: number;
}

/**
 * Compute statistics from events and DB.
 */
export const useStats = (
  db: DatabaseSync,
  events: Event[],
  intervalMs: number,
): Stats => {
  const [stats, setStats] = useState<Stats>({
    eventCount: 0,
    workerCount: 0,
    errorCount: 0,
  });

  useEffect(() => {
    const poll = () => {
      try {
        // Query total event count
        const eventStmt = db.prepare("SELECT COUNT(*) as count FROM events");
        const eventRow = eventStmt.get() as { count: number } | undefined;
        const eventCount = eventRow?.count ?? 0;

        // Query worker count
        const workerStmt = db.prepare(
          "SELECT COUNT(*) as count FROM worker_cursors",
        );
        const workerRow = workerStmt.get() as { count: number } | undefined;
        const workerCount = workerRow?.count ?? 0;

        // Count errors in the event array
        const errorCount = events.filter((e) =>
          e.type.match(/^sys\.worker\..*\.error$/)
        ).length;

        setStats({ eventCount, workerCount, errorCount });
      } catch (err) {
        console.error("Failed to compute stats:", err);
      }
    };

    poll();
    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [db, events, intervalMs]);

  return stats;
};
