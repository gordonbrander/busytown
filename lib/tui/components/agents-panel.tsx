/**
 * Agents panel component.
 * @module tui/components/agents-panel
 */

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { ForegroundColorName } from "chalk";
import type { AgentState } from "../use-data.ts";
import { activityChar } from "../format.ts";

export interface AgentsPanelProps {
  agents: AgentState[];
}

export const AgentsPanel: React.FC<AgentsPanelProps> = ({ agents }) => {
  // Track duration for processing agents
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      <Box paddingX={1}>
        <Text bold>Agents</Text>
      </Box>
      {agents.map((agent) => {
        const indicator = activityChar(agent.indicatorState);
        const duration = agent.startedAt
          ? Math.floor(Date.now() / 1000 - agent.startedAt)
          : 0;

        let stateLabel = "";
        let stateColor: ForegroundColorName = "white";

        if (agent.state === "idle") {
          stateLabel = "idle";
          stateColor = "gray";
        } else if (agent.state === "processing") {
          stateLabel = agent.eventId
            ? `processing #${agent.eventId}`
            : "processing";
          if (duration > 0) {
            stateLabel += ` (${duration}s)`;
          }
        } else if (agent.state === "error") {
          stateLabel = "error";
          stateColor = "red";
        }

        return (
          <Box key={agent.id} paddingX={1}>
            <Text>
              <Text
                color={agent.indicatorState === "error"
                  ? "red"
                  : agent.indicatorState === "pushed"
                  ? "magenta"
                  : agent.indicatorState === "processing"
                  ? "yellow"
                  : "gray"}
              >
                {indicator}
              </Text>
              {" "}
              <Text>{agent.id.padEnd(12)}</Text>
              {" "}
              <Text color={stateColor}>{stateLabel}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
