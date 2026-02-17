/**
 * Stats panel component.
 * @module tui/components/stats-panel
 */

import React from "react";
import { Box, Text } from "ink";
import type { Stats } from "../use-data.ts";

export interface StatsPanelProps {
  stats: Stats;
}

export const StatsPanel: React.FC<StatsPanelProps> = ({ stats }) => {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      <Box paddingX={1}>
        <Text bold>Stats</Text>
      </Box>
      <Box paddingX={1}>
        <Text>
          {stats.eventCount} events │ {stats.workerCount} workers │{" "}
          <Text color={stats.errorCount > 0 ? "red" : undefined}>
            {stats.errorCount} err
          </Text>
        </Text>
      </Box>
    </Box>
  );
};
