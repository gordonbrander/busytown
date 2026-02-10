/**
 * Mustache-style template rendering with shell escaping.
 *
 * - `{{key}}` resolves and shell-escapes the value (single-quote wrapping).
 * - `{{{key}}}` resolves and inserts the raw value (no escaping).
 * - Dot paths like `{{a.b.c}}` walk nested objects.
 * - Missing keys resolve to empty string.
 *
 * @module template
 */
import { shellEscape } from "./shell.ts";

/** Walk a dot-separated path on an object, returning undefined if any segment is missing. */
export const resolvePath = (
  obj: Record<string, unknown>,
  path: string,
): unknown => {
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

/** Render a template string, resolving placeholders against the given context. */
export const renderTemplate = (
  template: string,
  context: Record<string, unknown>,
): string => {
  // Process triple-brace first to avoid double-matching
  let result = template.replace(/\{\{\{([^}]+)\}\}\}/g, (_match, path) => {
    const value = resolvePath(context, path.trim());
    return value == null ? "" : String(value);
  });

  result = result.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
    const value = resolvePath(context, path.trim());
    return value == null ? "" : shellEscape(String(value));
  });

  return result;
};
