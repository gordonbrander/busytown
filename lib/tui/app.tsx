/**
 * Root TUI application component.
 * @module tui/app
 */

import React, { useCallback, useEffect, useMemo, useReducer } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import type { DatabaseSync } from "node:sqlite";
import { initialState, tuiReducer } from "./state.ts";
import { createSystem, worker } from "../worker.ts";
import { pushEvent } from "../event-queue.ts";
import { AgentsPanel } from "./components/agents-panel.tsx";
import { EventStreamPanel } from "./components/event-stream-panel.tsx";
import { FilesPanel } from "./components/files-panel.tsx";
import { ClaimsPanel } from "./components/claims-panel.tsx";
import { StatsPanel } from "./components/stats-panel.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { PermissionsPanel } from "./components/permissions-panel.tsx";

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
          dispatch({ type: "event", event });
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
                type: "indicator-transition",
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
                type: "indicator-transition",
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

  // Respond to a pending permission request with allow or deny.
  const respondPermission = useCallback(
    (behavior: "allow" | "deny") => {
      const req = state.permissionRequests[state.selectedPermissionIndex];
      if (!req) return;
      // Push permission response from user.
      // Reason: it's the user that is making this decision.
      // Also if it came from _tui, we would miss it because we ignore self
      // to prevent a recursive loop from our own events.
      pushEvent(db, "user", "permission.response", {
        request_id: req.requestId,
        behavior,
      });
    },
    [db, state.permissionRequests, state.selectedPermissionIndex],
  );

  // Keyboard input handling
  useInput((input, key) => {
    if (input === "q") {
      exit();
    } else if (input === "y" && state.permissionRequests.length > 0) {
      respondPermission("allow");
    } else if (input === "n" && state.permissionRequests.length > 0) {
      respondPermission("deny");
    } else if (input === "j" || key.downArrow) {
      if (state.permissionRequests.length > 0) {
        dispatch({ type: "permission-select", delta: 1 });
      } else {
        dispatch({ type: "scroll", delta: 1 });
      }
    } else if (input === "k" || key.upArrow) {
      if (state.permissionRequests.length > 0) {
        dispatch({ type: "permission-select", delta: -1 });
      } else {
        dispatch({ type: "scroll", delta: -1 });
      }
    } else if (input === "s") {
      dispatch({ type: "toggle-system-events" });
    } else if (key.tab) {
      dispatch({ type: "toggle-focus" });
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
          {state.permissionRequests.length > 0 && (
            <PermissionsPanel
              requests={state.permissionRequests}
              selectedIndex={state.selectedPermissionIndex}
            />
          )}
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
      <StatusBar hasPermissions={state.permissionRequests.length > 0} />
    </Box>
  );
};
