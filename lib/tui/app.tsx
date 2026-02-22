/**
 * Root TUI application component.
 * @module tui/app
 */

import React, { useEffect, useMemo, useReducer } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import type { DatabaseSync } from "node:sqlite";
import { initialState, tuiReducer } from "./state.ts";
import { createSystem, worker } from "../worker.ts";
import { AgentsPanel } from "./components/agents-panel.tsx";
import { EventStreamPanel } from "./components/event-stream-panel.tsx";
import { FilesPanel } from "./components/files-panel.tsx";
import { ClaimsPanel } from "./components/claims-panel.tsx";
import { StatsPanel } from "./components/stats-panel.tsx";
import { StatusBar } from "./components/status-bar.tsx";

export type AppProps = {
  db: DatabaseSync;
  pollIntervalMs: number;
};

export const App = (
  { db, pollIntervalMs }: AppProps,
): React.ReactElement => {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(tuiReducer, undefined, initialState);

  // Create worker system once, clean up on unmount
  useEffect(() => {
    const system = createSystem(db, pollIntervalMs);

    system.spawn(
      worker({
        id: "_tui",
        listen: ["*"],
        hidden: true,
        run: (event) => {
          dispatch({ type: "EVENT_RECEIVED", event });
        },
      }),
    );

    return () => {
      system.stop();
    };
  }, []);

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
      <StatusBar />
    </Box>
  );
};
