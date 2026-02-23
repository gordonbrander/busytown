/** Truncate a string to maxLen, adding ellipsis if needed. */
export const truncate = (s: string, maxLen: number): string =>
  s.length > maxLen ? s.slice(0, maxLen - 1) + "\u2026" : s;

/** Truncate a file path to fit a max width, using …/ prefix */
export const truncatePath = (path: string, maxLen: number): string => {
  if (path.length <= maxLen) return path;
  const ellipsis = "…/";
  const remaining = maxLen - ellipsis.length;
  if (remaining <= 0) return ellipsis;
  return ellipsis + path.slice(-remaining);
};
