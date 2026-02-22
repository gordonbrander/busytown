/**
 * Files panel component.
 * @module tui/components/files-panel
 */

import React from "react";
import { Box, Text } from "ink";
import type { ForegroundColorName } from "chalk";
import type { FileEvent } from "../state.ts";
import { fileOpChar, formatRelativeTime, truncatePath } from "../format.ts";

export interface FilesPanelProps {
  fileEvents: FileEvent[];
}

export const FilesPanel = (
  { fileEvents }: FilesPanelProps,
): React.ReactElement => {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      <Box paddingX={1}>
        <Text bold>Files</Text>
      </Box>
      {fileEvents.length === 0 && (
        <Box paddingX={1}>
          <Text color="gray">No file events</Text>
        </Box>
      )}
      {fileEvents.slice(-10).reverse().map((event, idx) => {
        const opChar = fileOpChar(event.op);
        let opColor: ForegroundColorName = "white";
        if (opChar === "A") opColor = "green";
        else if (opChar === "M") opColor = "yellow";
        else if (opChar === "D") opColor = "red";
        else if (opChar === "R") opColor = "blue";

        const path = truncatePath(event.path, 32);
        const time = formatRelativeTime(event.timestamp);

        return (
          <Box key={`${event.path}-${idx}`} paddingX={1}>
            <Text>
              <Text color={opColor}>{opChar}</Text>{" "}
              <Text>{path.padEnd(18)}</Text> <Text color="gray">{time}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
