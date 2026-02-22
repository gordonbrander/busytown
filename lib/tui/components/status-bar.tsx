/**
 * Status bar component.
 * @module tui/components/status-bar
 */

import React from "react";
import { Box, Text } from "ink";

export const StatusBar = (): React.ReactElement => {
  return (
    <Box paddingX={1} paddingY={0}>
      <Box flexGrow={1}>
        <Text>
          <Text bold>[j/k]</Text>scroll  <Text bold>[s]</Text>ystem{"  "}
          <Text bold>[Tab]</Text>focus  <Text bold>[q]</Text>uit
        </Text>
      </Box>
    </Box>
  );
};
