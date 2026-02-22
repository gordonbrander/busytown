/**
 * Claims panel component.
 * @module tui/components/claims-panel
 */

import React from "react";
import { Box, Text } from "ink";
import type { Claim } from "../state.ts";

export interface ClaimsPanelProps {
  claims: Claim[];
}

export const ClaimsPanel = ({ claims }: ClaimsPanelProps): React.ReactElement => {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      <Box paddingX={1}>
        <Text bold>Claims</Text>
      </Box>
      {claims.length === 0 && (
        <Box paddingX={1}>
          <Text color="gray">no active claims</Text>
        </Box>
      )}
      {claims.map((claim) => (
        <Box key={claim.eventId} paddingX={1}>
          <Text>
            #{claim.eventId} → {claim.workerId}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
