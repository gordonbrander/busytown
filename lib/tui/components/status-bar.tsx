/**
 * Status bar component.
 * @module tui/components/status-bar
 */

import React from "react";
import { Box, Text } from "ink";
import type { ForegroundColorName } from "chalk";
import { formatUptime } from "../format.ts";

export interface StatusBarProps {
  daemonRunning: boolean;
  uptime?: number;
  showSystemEvents: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  daemonRunning,
  uptime,
  showSystemEvents,
}) => {
  const statusIcon = daemonRunning ? "▲" : "▼";
  const statusText = daemonRunning
    ? `running ${uptime !== undefined ? formatUptime(uptime) : ""}`
    : "stopped";
  const statusColor: ForegroundColorName = daemonRunning ? "green" : "red";

  return (
    <Box paddingX={1} paddingY={0}>
      <Box flexGrow={1}>
        <Text>
          <Text bold>[j/k]</Text>scroll{"  "}
          <Text bold>[s]</Text>ystem{"  "}
          <Text bold>[Tab]</Text>focus{"  "}
          <Text bold>[q]</Text>uit
        </Text>
      </Box>
      <Box>
        <Text color={statusColor}>
          {statusIcon} {statusText}
        </Text>
      </Box>
    </Box>
  );
};
