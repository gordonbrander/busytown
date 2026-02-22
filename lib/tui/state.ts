/**
 * Centralized TUI state management: types, reducer, and pure helpers.
 * @module tui/state
 */

import type { Event } from "../event.ts";
import type { IndicatorState } from "./format.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentState = {
  id: string;
  state: "idle" | "processing" | "error";
  eventId?: number;
  startedAt?: number;
  indicatorState: IndicatorState;
};

export type FileEvent = {
  op: string;
  path: string;
  timestamp: number;
};

export type Claim = {
  eventId: number;
  workerId: string;
};

export type Stats = {
  eventCount: number;
  workerCount: number;
  errorCount: number;
};

export type DaemonStatus = {
  running: boolean;
  pid?: number;
  uptime?: number;
};

export type TuiState = {
  events: Event[];
  agentStates: Map<string, AgentState>;
  fileEvents: FileEvent[];
  claims: Claim[];
  stats: Stats;
  daemon: DaemonStatus;
  scrollOffset: number;
  showSystemEvents: boolean;
  focusedPanel: "agents" | "events";
  tick: number;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type TuiAction =
  | { type: "EVENT_RECEIVED"; event: Event }
  | { type: "STATS_RECEIVED"; eventCount: number; workerCount: number }
  | { type: "DAEMON_STATUS"; status: DaemonStatus }
  | {
    type: "INDICATOR_TRANSITION";
    agentId: string;
    from: IndicatorState;
    to: IndicatorState;
  }
  | { type: "SCROLL"; delta: number }
  | { type: "TOGGLE_SYSTEM_EVENTS" }
  | { type: "TOGGLE_FOCUS" }
  | { type: "TICK" };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const SYS_WORKER_RE = /^sys\.worker\.(.+)\.(start|finish|error)$/;

/** Extract agent ID from a sys.worker event type, or undefined. */
const parseSysWorkerEvent = (
  type: string,
): { agentId: string; kind: "start" | "finish" | "error" } | undefined => {
  const m = type.match(SYS_WORKER_RE);
  if (!m) return undefined;
  return { agentId: m[1], kind: m[2] as "start" | "finish" | "error" };
};

/** Incrementally update agent states from a single event. */
const applyEventToAgentStates = (
  states: Map<string, AgentState>,
  event: Event,
): Map<string, AgentState> => {
  const parsed = parseSysWorkerEvent(event.type);

  if (parsed && states.has(parsed.agentId)) {
    const next = new Map(states);
    const { agentId, kind } = parsed;

    if (kind === "start") {
      const eventId =
        typeof event.payload === "object" &&
          event.payload !== null &&
          "event_id" in event.payload
          ? (event.payload as { event_id: number }).event_id
          : undefined;
      next.set(agentId, {
        id: agentId,
        state: "processing",
        eventId,
        startedAt: event.timestamp,
        indicatorState: "received",
      });
    } else if (kind === "finish") {
      next.set(agentId, {
        id: agentId,
        state: "idle",
        indicatorState: "idle",
      });
    } else if (kind === "error") {
      next.set(agentId, {
        id: agentId,
        state: "error",
        indicatorState: "error",
      });
    }

    return next;
  }

  // Non-sys events emitted by an agent → flash "pushed"
  if (
    !event.type.startsWith("sys.") &&
    states.has(event.worker_id)
  ) {
    const current = states.get(event.worker_id)!;
    const next = new Map(states);
    next.set(event.worker_id, {
      ...current,
      indicatorState: "pushed",
    });
    return next;
  }

  return states;
};

/** Extract file events from a single event, or return empty array. */
const extractFileEvents = (event: Event): FileEvent[] => {
  if (!event.type.startsWith("file.")) return [];

  const op = event.type.replace("file.", "");
  const results: FileEvent[] = [];

  if (
    typeof event.payload === "object" &&
    event.payload !== null &&
    "paths" in event.payload &&
    Array.isArray((event.payload as { paths: unknown }).paths)
  ) {
    for (const path of (event.payload as { paths: string[] }).paths) {
      results.push({ op, path, timestamp: event.timestamp });
    }
  } else if (
    typeof event.payload === "object" &&
    event.payload !== null &&
    "path" in event.payload &&
    typeof (event.payload as { path: unknown }).path === "string"
  ) {
    results.push({
      op,
      path: (event.payload as { path: string }).path,
      timestamp: event.timestamp,
    });
  }

  return results;
};

/** Derive claims from agent states — agents currently processing with an eventId. */
const deriveClaims = (agentStates: Map<string, AgentState>): Claim[] => {
  const claims: Claim[] = [];
  for (const agent of agentStates.values()) {
    if (agent.state === "processing" && agent.eventId !== undefined) {
      claims.push({ eventId: agent.eventId, workerId: agent.id });
    }
  }
  return claims;
};

const SYS_ERROR_RE = /^sys\.worker\..*\.error$/;

/** Check if an event is a worker error. */
const isErrorEvent = (event: Event): boolean => SYS_ERROR_RE.test(event.type);

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

export const initialState = (agentIds: string[]): TuiState => {
  const agentStates = new Map<string, AgentState>();
  for (const id of agentIds) {
    agentStates.set(id, { id, state: "idle", indicatorState: "idle" });
  }

  return {
    events: [],
    agentStates,
    fileEvents: [],
    claims: [],
    stats: { eventCount: 0, workerCount: 0, errorCount: 0 },
    daemon: { running: false },
    scrollOffset: 0,
    showSystemEvents: false,
    focusedPanel: "events",
    tick: 0,
  };
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const tuiReducer = (state: TuiState, action: TuiAction): TuiState => {
  switch (action.type) {
    case "EVENT_RECEIVED": {
      const events = [...state.events, action.event].slice(-500);
      const agentStates = applyEventToAgentStates(
        state.agentStates,
        action.event,
      );
      const newFileEvents = extractFileEvents(action.event);
      const fileEvents = newFileEvents.length > 0
        ? [...state.fileEvents, ...newFileEvents].slice(-20)
        : state.fileEvents;
      const claims = deriveClaims(agentStates);
      const errorCount = state.stats.errorCount +
        (isErrorEvent(action.event) ? 1 : 0);

      return {
        ...state,
        events,
        agentStates,
        fileEvents,
        claims,
        stats: { ...state.stats, errorCount },
      };
    }

    case "STATS_RECEIVED":
      return {
        ...state,
        stats: {
          ...state.stats,
          eventCount: action.eventCount,
          workerCount: action.workerCount,
        },
      };

    case "DAEMON_STATUS":
      return { ...state, daemon: action.status };

    case "INDICATOR_TRANSITION": {
      const current = state.agentStates.get(action.agentId);
      if (!current || current.indicatorState !== action.from) return state;
      const agentStates = new Map(state.agentStates);
      agentStates.set(action.agentId, {
        ...current,
        indicatorState: action.to,
      });
      return { ...state, agentStates };
    }

    case "SCROLL":
      return {
        ...state,
        scrollOffset: Math.max(0, state.scrollOffset + action.delta),
      };

    case "TOGGLE_SYSTEM_EVENTS":
      return { ...state, showSystemEvents: !state.showSystemEvents };

    case "TOGGLE_FOCUS":
      return {
        ...state,
        focusedPanel: state.focusedPanel === "agents" ? "events" : "agents",
      };

    case "TICK":
      return { ...state, tick: state.tick + 1 };
  }
};
