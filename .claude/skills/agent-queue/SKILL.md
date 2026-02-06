---
name: agent-queue
description: Multi-agent orchestration over a shared SQLite event queue.
user_invocable: false
---

# Agent Queue

Run collaborative AI agents that communicate through a shared event queue. Each agent is a headless Claude Code instance with a markdown-defined persona and event subscriptions.

## Quick Start

1. **Start the runner**:

   ```bash
   ./agent-runner.ts run
   ```

2. **Push an event** to trigger agents:

   ```bash
   ./event-queue.ts push --worker user --data '{"type":"file.change","payload":{"path":"src/app.ts"}}'
   ```

## agent-runner.ts CLI

```
agent-runner.ts run [options]
```

| Option | Description |
|--------|-------------|
| `--agents-dir <path>` | Directory containing agent `.md` files (default: `agents/`) |
| `--db <path>` | SQLite database path (default: `events.db`) |
| `--poll <seconds>` | Poll interval in seconds (default: `5`) |
| `--agent <name>` | Only run a specific agent (by filename without `.md`) |
| `--help` | Show help message |

## How It Works

The runner operates a **poll-match-invoke** cycle:

1. **Poll** — each tick, poll the event queue for new events (per-agent cursor tracking)
2. **Match** — filter events against each agent's `listen` patterns
3. **Invoke** — for each agent with matched events, spawn a headless `claude --print` process with the agent's system prompt and matched events as the user message

Agents run concurrently but each agent processes one batch at a time (no duplicate invocations for the same agent).

## How to define agents

**Define an agent** in `agents/` (see [Creating Agents](create-agent.md)):

  ```yaml
  ---
  description: Reviews code changes
  listen:
    - "file.change"
  ---
  Your system prompt here...
  ```

## Supporting References

- [Event Queue CLI](event-queue.md) — the underlying `event-queue.ts` commands (`push`, `watch`, `since`, `events`, `cursor`)
- [Creating Agents](create-agent.md) — guide for defining new agent files
