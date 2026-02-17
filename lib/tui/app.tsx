/**
 * Root TUI application component.
 * @module tui/app
 */

import React, { useEffect, useMemo, useReducer } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import type { DatabaseSync } from "node:sqlite";
import { type DispatchRef, initialState, tuiReducer } from "./state.ts";
import { getRunningPid } from "../pid.ts";
import { AgentsPanel } from "./components/agents-panel.tsx";
import { EventStreamPanel } from "./components/event-stream-panel.tsx";
import { FilesPanel } from "./components/files-panel.tsx";
import { ClaimsPanel } from "./components/claims-panel.tsx";
import { StatsPanel } from "./components/stats-panel.tsx";
import { StatusBar } from "./components/status-bar.tsx";

export type AppProps = {
  db: DatabaseSync;
  agentIds: string[];
  dispatchRef: DispatchRef;
};

export const App: React.FC<AppProps> = ({ db, agentIds, dispatchRef }) => {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(tuiReducer, agentIds, initialState);

  // Connect dispatch to the worker bridge
  useEffect(() => {
    dispatchRef.current = dispatch;
    return () => {
      dispatchRef.current = null;
    };
  }, [dispatch, dispatchRef]);

  // Clock poll (1s) — timer-based concerns only
  useEffect(() => {
    let daemonStartTime: number | undefined;
    let wasRunning = false;

    const clock = setInterval(async () => {
      dispatch({ type: "TICK" });

      try {
        // Daemon status
        const pid = await getRunningPid();
        if (pid) {
          if (!wasRunning) daemonStartTime = Date.now();
          wasRunning = true;
          const uptime = daemonStartTime
            ? Math.floor((Date.now() - daemonStartTime) / 1000)
            : 0;
          dispatch({ type: "DAEMON_STATUS", status: { running: true, pid, uptime } });
        } else {
          if (wasRunning) daemonStartTime = undefined;
          wasRunning = false;
          dispatch({ type: "DAEMON_STATUS", status: { running: false } });
        }

        // Stats (cheap DB counts)
        const eventRow = db
          .prepare("SELECT COUNT(*) as count FROM events")
          .get() as { count: number } | undefined;
        const workerRow = db
          .prepare("SELECT COUNT(*) as count FROM worker_cursors")
          .get() as { count: number } | undefined;
        dispatch({
          type: "STATS_RECEIVED",
          eventCount: eventRow?.count ?? 0,
          workerCount: workerRow?.count ?? 0,
        });
      } catch {
        // PID check or DB query failed — leave state unchanged
      }
    }, 1000);

    return () => clearInterval(clock);
  }, [db, dispatch]);

  // Indicator animation effects — watch for transient states, dispatch transitions
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const [agentId, agent] of state.agentStates) {
      if (agent.indicatorState === "received") {
        timers.push(
          setTimeout(
            () =>
              dispatch({
                type: "INDICATOR_TRANSITION",
                agentId,
                from: "received",
                to: "processing",
              }),
            200,
          ),
        );
      } else if (agent.indicatorState === "pushed") {
        const revertTo = agent.state === "processing" ? "processing" : "idle";
        timers.push(
          setTimeout(
            () =>
              dispatch({
                type: "INDICATOR_TRANSITION",
                agentId,
                from: "pushed",
                to: revertTo,
              }),
            300,
          ),
        );
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [state.agentStates]);

  // Keyboard input handling
  useInput((input, key) => {
    if (input === "q") {
      exit();
    } else if (input === "j" || key.downArrow) {
      dispatch({ type: "SCROLL", delta: 1 });
    } else if (input === "k" || key.upArrow) {
      dispatch({ type: "SCROLL", delta: -1 });
    } else if (input === "s") {
      dispatch({ type: "TOGGLE_SYSTEM_EVENTS" });
    } else if (key.tab) {
      dispatch({ type: "TOGGLE_FOCUS" });
    }
  });

  // Terminal dimensions
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const eventStreamRows = Math.max(5, rows - 3);

  const agentsArray = useMemo(
    () => Array.from(state.agentStates.values()),
    [state.agentStates],
  );

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="row" flexGrow={1}>
        {/* Left column - fixed 34 chars width */}
        <Box flexDirection="column" width={34}>
          <AgentsPanel agents={agentsArray} />
          <FilesPanel fileEvents={state.fileEvents} />
          <ClaimsPanel claims={state.claims} />
          <StatsPanel stats={state.stats} />
        </Box>
        {/* Right column - fills remaining */}
        <Box flexDirection="column" flexGrow={1}>
          <EventStreamPanel
            events={state.events}
            scrollOffset={state.scrollOffset}
            showSystemEvents={state.showSystemEvents}
            focused={state.focusedPanel === "events"}
            visibleRows={eventStreamRows}
          />
        </Box>
      </Box>
      <StatusBar
        daemonRunning={state.daemon.running}
        uptime={state.daemon.uptime}
        showSystemEvents={state.showSystemEvents}
      />
    </Box>
  );
};
