/**
 * CLI command to visualise the agent event-processing chain.
 * @module map
 */

import { Command } from "@cliffy/command";
import { type AgentDef, loadAllAgents } from "../lib/agent.ts";
import { renderMermaidAscii } from "beautiful-mermaid";

/** Sanitise a string so it can be used as a Mermaid node ID. */
const nodeId = (s: string): string => s.replace(/[^a-zA-Z0-9_]/g, "_");

/** Build a lookup from event pattern to the agents that listen for it. */
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

/** Render a Mermaid flowchart showing agents as nodes and events as edges. */
export const renderMermaidSyntax = (agents: AgentDef[]): string => {
  if (agents.length === 0) return "%% no agents found";

  const lines: string[] = ["flowchart LR"];

  // Collect all emitted event types and find entry points
  const allEmitted = new Set<string>();
  for (const agent of agents) {
    for (const e of agent.emits) allEmitted.add(e);
  }

  const listenerIndex = buildListenerIndex(agents);

  // Entry points: listen patterns that don't match any emitted event
  const entryEvents = new Set<string>();
  for (const pattern of listenerIndex.keys()) {
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

  // Declare entry-point nodes (plain text style)
  for (const evt of entryEvents) {
    lines.push(`  ${nodeId(evt)}[${evt}]:::entry`);
  }

  // Declare agent nodes (rounded boxes are the default in Mermaid)
  for (const agent of agents) {
    lines.push(`  ${nodeId(agent.id)}(${agent.id})`);
  }

  // Edges: entry events → agents
  for (const evt of entryEvents) {
    const listeners = listenerIndex.get(evt) ?? [];
    for (const listener of listeners) {
      lines.push(
        `  ${nodeId(evt)} -->|${evt}|${nodeId(listener.id)}`,
      );
    }
  }

  // Edges: agent → agent (via emitted events)
  for (const agent of agents) {
    for (const emitted of agent.emits) {
      const listeners = findListeners(emitted, agents);
      for (const listener of listeners) {
        lines.push(
          `  ${nodeId(agent.id)} -->|${emitted}|${nodeId(listener.id)}`,
        );
      }
      // Terminal events (no listener) — show as plain sink node
      if (listeners.length === 0) {
        lines.push(`  ${nodeId(emitted)}[${emitted}]:::sink`);
        lines.push(
          `  ${nodeId(agent.id)} -->|${emitted}|${nodeId(emitted)}`,
        );
      }
    }
  }

  return lines.join("\n");
};

export function mapCommand(defaultAgentsDir = "agents/") {
  return new Command()
    .description("Visualise the agent event-processing chain.")
    .option(
      "--agents-dir <path:file>",
      "Directory containing agent .md files",
      { default: defaultAgentsDir },
    )
    .option("--render", "Render as ASCII art (experimental)")
    .action(async (options) => {
      const agents = await Array.fromAsync(loadAllAgents(options.agentsDir));
      const mermaid = renderMermaidSyntax(agents);

      if (options.render) {
        const ascii = renderMermaidAscii(mermaid);
        console.log(ascii);
        return;
      }

      console.log(mermaid);
    });
}
