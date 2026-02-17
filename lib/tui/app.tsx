/**
 * Root TUI application component.
 * @module tui/app
 */

import React, { useMemo, useState } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import type { DatabaseSync } from "node:sqlite";
import {
  useAgentStates,
  useClaims,
  useFileEvents,
  usePollEvents,
  useStats,
} from "./use-data.ts";
import { useDaemonStatus } from "./use-daemon-status.ts";
import { AgentsPanel } from "./components/agents-panel.tsx";
import { EventStreamPanel } from "./components/event-stream-panel.tsx";
import { FilesPanel } from "./components/files-panel.tsx";
import { ClaimsPanel } from "./components/claims-panel.tsx";
import { StatsPanel } from "./components/stats-panel.tsx";
import { StatusBar } from "./components/status-bar.tsx";

export interface AppProps {
  db: DatabaseSync;
  agentIds: string[];
  pollIntervalMs: number;
}

export const App: React.FC<AppProps> = ({ db, agentIds, pollIntervalMs }) => {
  const { exit } = useApp();

  // Data hooks
  const events = usePollEvents(db, pollIntervalMs);
  const agentStates = useAgentStates(events, agentIds);
  const fileEvents = useFileEvents(events);
  const daemon = useDaemonStatus();
  const stats = useStats(db, events, pollIntervalMs * 2);

  // Derive active event IDs from agent states
  const activeEventIds = useMemo(() => {
    const ids = new Set<number>();
    for (const state of agentStates.values()) {
      if (state.eventId && state.state === "processing") {
        ids.add(state.eventId);
      }
    }
    return ids;
  }, [agentStates]);

  const claims = useClaims(db, activeEventIds, pollIntervalMs);

  // Terminal dimensions
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24; // Default to 24 if not available
  // Reserve 1 row for status bar, 2 rows for event stream panel border
  const eventStreamRows = Math.max(5, rows - 3);

  // UI state
  const [scrollOffset, setScrollOffset] = useState(0);
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [focusedPanel, setFocusedPanel] = useState<"agents" | "events">(
    "events",
  );

  // Keyboard input handling
  useInput((input, key) => {
    if (input === "q") {
      exit();
    } else if (input === "j" || key.downArrow) {
      setScrollOffset((o) => o + 1);
    } else if (input === "k" || key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (input === "s") {
      setShowSystemEvents((s) => !s);
    } else if (key.tab) {
      setFocusedPanel((p) => p === "agents" ? "events" : "agents");
    }
  });

  // Convert agent states map to array for rendering
  const agentsArray = useMemo(() => {
    return Array.from(agentStates.values());
  }, [agentStates]);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexDirection="row" flexGrow={1}>
        {/* Left column - fixed 34 chars width */}
        <Box flexDirection="column" width={34}>
          <AgentsPanel agents={agentsArray} />
          <FilesPanel fileEvents={fileEvents} />
          <ClaimsPanel claims={claims} />
          <StatsPanel stats={stats} />
        </Box>
        {/* Right column - fills remaining */}
        <Box flexDirection="column" flexGrow={1}>
          <EventStreamPanel
            events={events}
            scrollOffset={scrollOffset}
            showSystemEvents={showSystemEvents}
            focused={focusedPanel === "events"}
            visibleRows={eventStreamRows}
          />
        </Box>
      </Box>
      <StatusBar
        daemonRunning={daemon.running}
        uptime={daemon.uptime}
        showSystemEvents={showSystemEvents}
      />
    </Box>
  );
};
