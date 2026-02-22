/**
 * Agents panel component.
 * @module tui/components/agents-panel
 */

import React from "react";
import { Box, Text } from "ink";
import type { ForegroundColorName } from "chalk";
import type { AgentState } from "../state.ts";
import { activityChar } from "../format.ts";

export type AgentsPanelProps = {
  agents: AgentState[];
};

export const AgentsPanel: React.FC<AgentsPanelProps> = ({ agents }) => {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      <Box paddingX={1}>
        <Text bold>Agents</Text>
      </Box>
      {agents.map((agent) => {
        const indicator = activityChar(agent.indicatorState);

        let stateLabel = "";
        let stateColor: ForegroundColorName = "white";

        if (agent.state === "idle") {
          stateLabel = "idle";
          stateColor = "gray";
        } else if (agent.state === "processing") {
          stateLabel = agent.eventId
            ? `processing #${agent.eventId}`
            : "processing";
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
