/**
 * Zod schemas for permission request/response event payloads.
 *
 * These events flow through the shared SQLite event queue:
 * - `permission.request` is pushed by the MCP server when Claude needs a tool approval
 * - `permission.response` is pushed by the TUI when the user presses y/n
 *
 * @module permission
 */

import { z } from "zod/v4";

export const PermissionRequestPayloadSchema = z.object({
  request_id: z.string(),
  agent_id: z.string(),
  tool_name: z.string(),
  tool_input: z.unknown(),
});

export type PermissionRequestPayload = z.infer<
  typeof PermissionRequestPayloadSchema
>;

export const PermissionBehaviorSchema = z.enum(["allow", "deny"]);

export type PermissionBehavior = z.infer<typeof PermissionBehaviorSchema>;

export const PermissionResponsePayloadSchema = z.object({
  request_id: z.string(),
  behavior: PermissionBehaviorSchema,
  message: z.string().optional(),
});

export type PermissionResponsePayload = z.infer<
  typeof PermissionResponsePayloadSchema
>;
