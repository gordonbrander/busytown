/**
 * CLI command to visualise the agent event-processing chain.
 * @module map
 */

import { Command } from "@cliffy/command";
import { type AgentDef, loadAllAgents } from "../lib/runner.ts";

/** Build a lookup from event type to the agents that listen for it. */
const buildListenerIndex = (
  agents: AgentDef[],
): Map<string, AgentDef[]> => {
  const index = new Map<string, AgentDef[]>();
  for (const agent of agents) {
    for (const pattern of agent.listen) {
      const list = index.get(pattern) ?? [];
      list.push(agent);
      index.set(pattern, list);
    }
  }
  return index;
};

/** Find agents whose listen patterns match a given event type. */
const findListeners = (
  eventType: string,
  agents: AgentDef[],
): AgentDef[] => {
  const matches: AgentDef[] = [];
  for (const agent of agents) {
    for (const pattern of agent.listen) {
      if (pattern === "*") {
        matches.push(agent);
        break;
      } else if (pattern === eventType) {
        matches.push(agent);
        break;
      } else if (pattern.endsWith(".*")) {
        const prefix = pattern.slice(0, -1);
        if (eventType.startsWith(prefix)) {
          matches.push(agent);
          break;
        }
      }
    }
  }
  return matches;
};

/** Render a DOT digraph showing agents as nodes and events as edges. */
export const renderDot = (agents: AgentDef[]): string => {
  if (agents.length === 0) return "// no agents found";

  const lines: string[] = [
    "digraph busytown {",
    "  rankdir=LR;",
    '  node [shape=box, style=rounded, fontname="Helvetica"];',
    '  edge [fontname="Helvetica", fontsize=10];',
    "",
  ];

  // Collect all emitted event types and find entry points
  // (events that are listened to but not emitted by any agent)
  const allEmitted = new Set<string>();
  for (const agent of agents) {
    for (const e of agent.emits) allEmitted.add(e);
  }

  const listenerIndex = buildListenerIndex(agents);

  // Entry points: listen patterns that don't match any emitted event
  const entryEvents = new Set<string>();
  for (const pattern of listenerIndex.keys()) {
    // Check if any emitted event would match this pattern
    let hasSource = false;
    for (const emitted of allEmitted) {
      if (pattern === emitted) {
        hasSource = true;
        break;
      }
      if (pattern === "*") {
        hasSource = true;
        break;
      }
      if (pattern.endsWith(".*")) {
        const prefix = pattern.slice(0, -1);
        if (emitted.startsWith(prefix)) {
          hasSource = true;
          break;
        }
      }
    }
    if (!hasSource) entryEvents.add(pattern);
  }

  // Declare entry-point nodes with a different shape
  if (entryEvents.size > 0) {
    lines.push("  // entry points");
    for (const evt of entryEvents) {
      lines.push(
        `  ${quote(evt)} [shape=plaintext, fontname="Helvetica"];`,
      );
    }
    lines.push("");
  }

  // Declare agent nodes
  lines.push("  // agents");
  for (const agent of agents) {
    lines.push(`  ${quote(agent.id)} [label=${quote(agent.id)}];`);
  }
  lines.push("");

  // Edges: entry events → agents
  if (entryEvents.size > 0) {
    lines.push("  // entry edges");
    for (const evt of entryEvents) {
      const listeners = listenerIndex.get(evt) ?? [];
      for (const listener of listeners) {
        lines.push(
          `  ${quote(evt)} -> ${quote(listener.id)} [label=${quote(evt)}];`,
        );
      }
    }
    lines.push("");
  }

  // Edges: agent → agent (via emitted events)
  lines.push("  // agent edges");
  for (const agent of agents) {
    for (const emitted of agent.emits) {
      const listeners = findListeners(emitted, agents);
      for (const listener of listeners) {
        lines.push(
          `  ${quote(agent.id)} -> ${quote(listener.id)} [label=${quote(emitted)}];`,
        );
      }
      // Terminal events (no listener) — show as plaintext sink
      if (listeners.length === 0) {
        lines.push(
          `  ${quote(emitted)} [shape=plaintext, fontname="Helvetica"];`,
        );
        lines.push(
          `  ${quote(agent.id)} -> ${quote(emitted)} [label=${quote(emitted)}];`,
        );
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
};

/** Quote a string for DOT attribute values. */
const quote = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;

export function mapCommand(defaultAgentsDir = "agents/") {
  return new Command()
    .description("Visualise the agent event-processing chain.")
    .option(
      "--agents-dir <path:file>",
      "Directory containing agent .md files",
      { default: defaultAgentsDir },
    )
    .action(async (options) => {
      const agents = await Array.fromAsync(loadAllAgents(options.agentsDir));
      console.log(renderDot(agents));
    });
}
