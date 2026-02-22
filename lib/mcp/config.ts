/**
 * Generate per-agent MCP config files for Claude Code's --mcp-config flag.
 *
 * Each agent gets its own config file at `.busytown/mcp-<agentId>.json`
 * that points to the `busytown mcp-server` command with the correct
 * --db path and agent ID.
 *
 * @module mcp-config
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export const MCP_SERVER_NAME = "busytown";
export const MCP_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__check_permission`;

export type McpConfig = {
  mcpServers: Record<string, {
    command: string;
    args: string[];
  }>;
};

export type McpConfigOptions = {
  dbPath: string;
  agentId: string;
};

/** Generate the MCP config JSON object for a single agent. */
export const generateMcpConfig = (
  { dbPath, agentId }: McpConfigOptions,
): McpConfig => ({
  mcpServers: {
    [MCP_SERVER_NAME]: {
      command: "busytown",
      args: ["mcp-server", "--db", dbPath, agentId],
    },
  },
});

export type WriteMcpConfigOptions = McpConfigOptions & {
  projectRoot: string;
};

/**
 * Write the MCP config file for an agent and return the file path.
 * Creates the `.busytown/` directory if it doesn't exist.
 */
export const writeMcpConfig = async (
  { dbPath, agentId, projectRoot }: WriteMcpConfigOptions,
): Promise<string> => {
  const dir = join(projectRoot, ".busytown");
  await mkdir(dir, { recursive: true });

  const config = generateMcpConfig({ dbPath, agentId });
  const filePath = join(dir, `mcp-${agentId}.json`);
  await Deno.writeTextFile(filePath, JSON.stringify(config, null, 2) + "\n");

  return filePath;
};
