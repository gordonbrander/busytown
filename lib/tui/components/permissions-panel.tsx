/**
 * Permissions panel component — shows pending permission requests.
 * @module tui/components/permissions-panel
 */

import React from "react";
import { Box, Text } from "ink";
import type { PermissionRequest } from "../state.ts";
import { truncate } from "../../truncate.ts";

export type PermissionsPanelProps = {
  requests: PermissionRequest[];
  selectedIndex: number;
};

/** Format tool input as a short summary string. */
const formatInput = (input: unknown): string => {
  if (typeof input === "string") return truncate(input, 24);
  if (typeof input === "object" && input !== null) {
    const json = JSON.stringify(input);
    return truncate(json, 24);
  }
  return "";
};

export const PermissionsPanel = (
  { requests, selectedIndex }: PermissionsPanelProps,
): React.ReactElement => {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
    >
      <Box paddingX={1}>
        <Text bold color="yellow">
          Permissions ({requests.length})
        </Text>
      </Box>
      {requests.map((req, i) => {
        const selected = i === selectedIndex;
        const inputStr = formatInput(req.toolInput);
        return (
          <Box key={req.requestId} paddingX={1}>
            <Text>
              {selected ? <Text color="yellow">&gt;</Text> : "  "}
              <Text color="cyan">[{truncate(req.agentId, 12)}]</Text>{" "}
              <Text bold>{req.toolName}</Text>
              {inputStr ? <Text color="gray">{inputStr}</Text> : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
