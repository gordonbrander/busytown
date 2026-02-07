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
   scripts/daemon.sh start
   ```

   Other daemon commands: `stop`, `restart`, `status`, `logs`

2. **Push an event** to trigger agents:

   ```bash
   scripts/event-queue.ts push --worker user --data '{"type":"file.change","payload":{"path":"src/app.ts"}}'
   ```

To run the agent runner in the foreground instead, use `scripts/agent-runner.ts run` directly.

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

## Task Board

Agents can coordinate work through a shared task board. Tasks can be created, claimed (compare-and-swap), updated, and deleted. All mutations emit events to the event queue.

```bash
# Add a task
scripts/task-board.ts add --worker user --title "Review PR #42"

# List open tasks
scripts/task-board.ts list --status open

# Claim a task (atomic — only one agent wins)
scripts/task-board.ts claim --worker agent-1 --id 1

# Mark done (only claim holder can update)
scripts/task-board.ts update --worker agent-1 --id 1 --status done

# View summary
scripts/task-board.ts summary
```

See [Task Board CLI](task-board.md) for the full reference.

## Supporting References

- [Event Queue CLI](event-queue.md) — the underlying `event-queue.ts` commands (`push`, `watch`, `since`, `events`, `cursor`)
- [Task Board CLI](task-board.md) — shared task board for multi-agent work coordination
- [Creating Agents](create-agent.md) — guide for defining new agent files
