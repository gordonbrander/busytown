/**
 * Formatting utilities for TUI display.
 * @module tui/format
 */

/** Format a unix timestamp as relative time: "0.3s ago", "2m ago", "1h ago" */
export const formatRelativeTime = (unixEpoch: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const delta = now - unixEpoch;

  if (delta < 1) return "now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
};

/** Map file event type to single-char prefix: A, M, D, R */
export const fileOpChar = (eventType: string): string => {
  if (eventType.includes("add") || eventType.includes("create")) return "A";
  if (eventType.includes("modify") || eventType.includes("update")) return "M";
  if (eventType.includes("delete") || eventType.includes("remove")) return "D";
  if (eventType.includes("rename") || eventType.includes("move")) return "R";
  return "?";
};

/** Truncate a file path to fit a max width, using …/ prefix */
export const truncatePath = (path: string, maxLen: number): string => {
  if (path.length <= maxLen) return path;
  const ellipsis = "…/";
  const remaining = maxLen - ellipsis.length;
  if (remaining <= 0) return ellipsis;
  return ellipsis + path.slice(-remaining);
};

/** Agent activity indicator character and style */
export type IndicatorState =
  | "idle"
  | "received"
  | "processing"
  | "pushed"
  | "error";

export const activityChar = (state: IndicatorState): string => {
  switch (state) {
    case "idle":
      return "·";
    case "received":
      return "■";
    case "processing":
      return "▪";
    case "pushed":
      return "◆";
    case "error":
      return "!";
  }
};
