/**
 * Event stream panel component.
 * @module tui/components/event-stream-panel
 */

import React from "react";
import { Box, Text } from "ink";
import type { Event } from "../../event.ts";
import { formatRelativeTime } from "../format.ts";

export interface EventStreamPanelProps {
  events: Event[];
  scrollOffset: number;
  showSystemEvents: boolean;
  focused: boolean;
  visibleRows: number;
}

export const EventStreamPanel: React.FC<EventStreamPanelProps> = ({
  events,
  scrollOffset,
  showSystemEvents,
  focused,
  visibleRows,
}) => {
  // Filter events
  let filtered = events.filter((e) => {
    // Exclude file events (they have their own panel)
    if (e.type.startsWith("file.")) return false;

    // Optionally exclude system events
    if (!showSystemEvents && e.type.startsWith("sys.")) return false;

    return true;
  });

  // Reverse to show newest first
  filtered = filtered.reverse();

  // Apply scroll offset
  const visible = filtered.slice(scrollOffset, scrollOffset + visibleRows);

  return (
    <Box
      flexDirection="column"
      borderStyle={focused ? "bold" : "single"}
      borderColor="gray"
      flexGrow={1}
    >
      <Box paddingX={1}>
        <Text bold>Event Stream</Text>
        {showSystemEvents && (
          <Text color="gray"> (showing system events)</Text>
        )}
      </Box>
      {visible.length === 0 && (
        <Box paddingX={1}>
          <Text color="gray">No events</Text>
        </Box>
      )}
      {visible.map((event) => {
        const isSys = event.type.startsWith("sys.");
        const idStr = `#${event.id}`.padEnd(6);
        const typeStr = event.type.slice(0, 20).padEnd(20);
        const workerStr = event.worker_id.slice(0, 10).padEnd(10);
        const timeStr = formatRelativeTime(event.timestamp);

        return (
          <Box key={event.id} paddingX={1}>
            <Text color={isSys ? "gray" : undefined}>
              {idStr} {typeStr} {workerStr} {timeStr}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
