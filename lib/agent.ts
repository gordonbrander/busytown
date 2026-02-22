/**
 * Agent definition schemas, types, and loading functions.
 *
 * Extracted from `runner.ts` so that both `runner.ts` and `agent-watcher.ts`
 * can depend on this module without creating a circular import.
 *
 * @module agent
 */
import { z } from "zod/v4";
import { extractYaml } from "@std/front-matter";
import { join } from "node:path";
import { pathToSlug } from "./slug.ts";
import { create as createLogger } from "./logger.ts";

const logger = createLogger({ source: "agent" });

/**
 * Validates YAML frontmatter attributes from agent markdown files.
 * Currently describes the union of all properties for all agent types.
 * Later, we disambiguate this into a discriminated union when constructing the
 * agent def.
 */
const AgentFrontmatterSchema = z.object({
  type: z.enum(["claude", "shell"]).default("claude"),
  description: z.string().default(""),
  listen: z.array(z.string()).default([]),
  ignore_self: z.boolean().default(true),
  emits: z.array(z.string()).default([]),
  allowed_tools: z.array(z.string()).default([]),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

export const ClaudeAgentDefSchema = z.object({
  id: z.string(),
  type: z.literal("claude"),
  description: z.string().default(""),
  listen: z.array(z.string()).default([]),
  ignoreSelf: z.boolean().default(true),
  emits: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  body: z.string().default("").describe("The agent system prompt"),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
});

export type ClaudeAgentDef = z.infer<typeof ClaudeAgentDefSchema>;

export const ShellAgentDefSchema = z.object({
  id: z.string(),
  type: z.literal("shell"),
  description: z.string().default(""),
  listen: z.array(z.string()).default([]),
  ignoreSelf: z.boolean().default(true),
  emits: z.array(z.string()).default([]),
  body: z.string().describe("The script to run"),
});

export type ShellAgentDef = z.infer<typeof ShellAgentDefSchema>;

export const AgentDefSchema = z.union([
  ClaudeAgentDefSchema,
  ShellAgentDefSchema,
]);

export type AgentDef = z.infer<typeof AgentDefSchema>;

/** Load a single agent definition from a markdown file with YAML frontmatter. */
export const loadAgentDef = async (filePath: string): Promise<AgentDef> => {
  const raw = await Deno.readTextFile(filePath);
  const { attrs, body } = extractYaml(raw);
  const frontmatter = AgentFrontmatterSchema.parse(attrs);
  const id = pathToSlug(filePath);

  if (id == undefined) {
    throw new Error(`Could not transform filename to id: ${filePath}`);
  }

  switch (frontmatter.type) {
    case "claude":
      return {
        id,
        type: "claude",
        description: frontmatter.description,
        listen: frontmatter.listen,
        ignoreSelf: frontmatter.ignore_self,
        emits: frontmatter.emits,
        allowedTools: frontmatter.allowed_tools,
        body: body.trim(),
        model: frontmatter.model,
        effort: frontmatter.effort,
      };
    case "shell":
      return {
        id,
        type: frontmatter.type,
        description: frontmatter.description,
        listen: frontmatter.listen,
        ignoreSelf: frontmatter.ignore_self,
        emits: frontmatter.emits,
        body,
      };
    default:
      // Never should happen
      throw new Error(`Unsupported agent type: ${frontmatter.type}`);
  }
};

/** Load all agent definitions from a directory. */
export async function* loadAllAgents(
  agentsDir: string,
): AsyncGenerator<AgentDef> {
  try {
    for await (const entry of Deno.readDir(agentsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      try {
        yield await loadAgentDef(join(agentsDir, entry.name));
      } catch (err) {
        logger.error("Failed to load agent", {
          agent_id: entry.name,
          error: String(err),
        });
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      logger.error("Agents directory not found", {
        dir: agentsDir,
        error: String(err),
      });
      return;
    }
    throw err;
  }
}
