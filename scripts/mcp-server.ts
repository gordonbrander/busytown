#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/**
 * CLI entrypoint for the MCP permission server.
 *
 * Spawned by Claude Code as a stdio MCP subprocess. Takes --db and a
 * positional agent-id argument.
 *
 * @module scripts/mcp-server
 */

import { Command } from "@cliffy/command";
import { startMcpServer } from "../lib/mcp/server.ts";

const command = new Command()
  .name("mcp-server")
  .description("MCP permission prompt server (stdio transport).")
  .option("--db <path:string>", "Database path", { required: true })
  .arguments("<agent-id:string>")
  .action(async (options, agentId) => {
    await startMcpServer(options.db, agentId);
  });

export { command as mcpServerCommand };

if (import.meta.main) {
  await command.parse(Deno.args);
}
