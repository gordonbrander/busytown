/**
 * Status bar component.
 * @module tui/components/status-bar
 */

import React from "react";
import { Box, Text } from "ink";

export type StatusBarProps = {
  hasPermissions?: boolean;
};

export const StatusBar = (
  { hasPermissions }: StatusBarProps,
): React.ReactElement => {
  return (
    <Box paddingX={1} paddingY={0}>
      <Box flexGrow={1}>
        <Text>
          {hasPermissions && (
            <>
              <Text bold color="yellow">[y]</Text>
              <Text color="yellow">allow</Text>{"  "}
              <Text bold color="yellow">[n]</Text>
              <Text color="yellow">deny</Text>{"  "}
            </>
          )}
          <Text bold>[j/k]</Text>scroll <Text bold>[s]</Text>ystem{"  "}
          <Text bold>[Tab]</Text>focus <Text bold>[q]</Text>uit
        </Text>
      </Box>
    </Box>
  );
};
