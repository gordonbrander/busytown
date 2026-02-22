/**
 * MCP server that bridges Claude Code permission prompts to the event queue.
 *
 * Exposes a single `check_permission` tool. When called, it pushes a
 * `permission.request` event, then polls for a matching `permission.response`.
 *
 * @module mcp-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { DatabaseSync } from "node:sqlite";
import { getEventsSince, openDb, pushEvent } from "../event-queue.ts";
import {
  type PermissionResponsePayload,
  PermissionResponsePayloadSchema,
} from "./permission.ts";

const POLL_INTERVAL_MS = 200;
const TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the event queue for a permission.response matching the given request_id.
 * Returns the response payload, or a timeout deny after TIMEOUT_MS.
 */
const waitForResponse = async (
  db: DatabaseSync,
  requestId: string,
  sinceId: number,
): Promise<PermissionResponsePayload> => {
  const deadline = Date.now() + TIMEOUT_MS;
  let cursor = sinceId;

  while (Date.now() < deadline) {
    const events = getEventsSince(db, {
      sinceId: cursor,
      filterType: "permission.response",
    });

    for (const event of events) {
      const parsed = PermissionResponsePayloadSchema.safeParse(event.payload);
      if (parsed.success && parsed.data.request_id === requestId) {
        return parsed.data;
      }
    }

    if (events.length > 0) {
      cursor = events[events.length - 1].id;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { request_id: requestId, behavior: "deny", message: "Timed out" };
};

/** Start the MCP server and block on stdio transport. */
export const startMcpServer = async (
  dbPath: string,
  agentId: string,
): Promise<void> => {
  const db = openDb(dbPath);

  const server = new McpServer({
    name: "busytown",
    version: "1.0.0",
  });

  server.registerTool("check_permission", {
    description:
      "Request permission from the user to use a tool. Blocks until the user responds.",
    inputSchema: {
      tool_name: z.string(),
      input: z.record(z.string(), z.any()),
    },
  }, async ({ tool_name, input }) => {
    const requestId = crypto.randomUUID();

    const requestEvent = pushEvent(db, agentId, "permission.request", {
      request_id: requestId,
      agent_id: agentId,
      tool_name,
      tool_input: input,
    });

    const response = await waitForResponse(db, requestId, requestEvent.id);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          behavior: response.behavior,
          ...(response.message ? { message: response.message } : {}),
        }),
      }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up DB connection when the server disconnects
  server.server.onclose = () => db.close();
};
