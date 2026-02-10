/**
 * Shell utilities.
 *
 * @module shell
 */

/** Shell-escape a value by wrapping in single quotes, escaping internal single quotes. */
export const shellEscape = (value: string): string =>
  "'" + value.replace(/'/g, "'\\''") + "'";
