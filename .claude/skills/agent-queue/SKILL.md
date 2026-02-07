---
name: agent-queue
description: Multi-agent orchestration over a shared SQLite event queue.
user_invocable: false
---

# Agent Queue

Run collaborative AI agents that communicate through a shared event queue. Each agent is a headless Claude Code instance with a markdown-defined persona and event subscriptions.

## Quick Start

1. **Start the daemon** (runs in background with auto-restart):

   ```bash
   deno task agent-runner start
   ```

   Other daemon commands: `stop`, `restart`, `status`

2. **Push an event** to trigger agents:

   ```bash
   deno task event-queue push --worker user --data '{"type":"file.change","payload":{"path":"src/app.ts"}}'
   ```

To run the agent runner in the foreground instead, use `deno task agent-runner run` directly.

## agent-runner CLI

```
deno task agent-runner <command> [options]
```

| Command | Description |
|---------|-------------|
| `run` | Start the agent poll loop (foreground) |
| `start` | Start the agent runner as a background daemon |
| `stop` | Stop the background daemon |
| `restart` | Restart the background daemon |
| `status` | Check if the daemon is running |

**Runner options** (for `run`, `start`, `restart`):

| Option | Description |
|--------|-------------|
| `--agents-dir <path>` | Directory containing agent `.md` files (default: `agents/`) |
| `--db <path>` | SQLite database path (default: `events.db`) |
| `--poll <seconds>` | Poll interval in seconds (default: `5`) |
| `--agent <name>` | Only run a specific agent (by filename without `.md`) |
| `--agent-cwd <path>` | Working directory for sub-agents (default: `src/`) |
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

## Task Board

Agents can coordinate work through a shared task board. Tasks can be created, claimed (compare-and-swap), updated, and deleted. All mutations emit events to the event queue.

```bash
# Add a task
deno task task-board add --worker user --title "Review PR #42"

# List open tasks
deno task task-board list --status open

# Claim a task (atomic — only one agent wins)
deno task task-board claim --worker agent-1 --id 1

# Mark done (only claim holder can update)
deno task task-board update --worker agent-1 --id 1 --status done

# View summary
deno task task-board summary
```

See [Task Board CLI](task-board.md) for the full reference.

## Supporting References

- [Event Queue CLI](event-queue.md) — the underlying `deno task event-queue` commands (`push`, `watch`, `since`, `events`, `cursor`)
- [Task Board CLI](task-board.md) — shared task board for multi-agent work coordination
- [Creating Agents](create-agent.md) — guide for defining new agent files
