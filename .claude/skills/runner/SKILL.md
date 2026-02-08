---
name: runner
description: Multi-agent orchestration over a shared SQLite event queue.
user_invocable: false
---

# Agent Queue

Run collaborative AI agents that communicate through a shared event queue. Each
agent is a headless Claude Code instance with a markdown-defined persona and
event subscriptions.

## Quick Start

1. **Start the daemon** (runs in background with auto-restart):

   ```bash
   deno task runner start
   ```

   Other daemon commands: `stop`, `restart`, `status`

2. **Push an event** to trigger agents:

   ```bash
   deno task events push --worker user --type file.change --payload '{"path":"src/app.ts"}'
   ```

To run the agent runner in the foreground instead, use `deno task runner run`
directly.

## runner CLI

```
deno task runner <command> [options]
```

| Command   | Description                                   |
| --------- | --------------------------------------------- |
| `run`     | Start the agent poll loop (foreground)        |
| `start`   | Start the agent runner as a background daemon |
| `stop`    | Stop the background daemon                    |
| `restart` | Restart the background daemon                 |
| `status`  | Check if the daemon is running                |

**Runner options** (for `run`, `start`, `restart`):

| Option                | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `--agents-dir <path>` | Directory containing agent `.md` files (default: `agents/`) |
| `--db <path>`         | SQLite database path (default: `events.db`)                 |
| `--poll <seconds>`    | Poll interval in seconds (default: `5`)                     |
| `--agent <name>`      | Only run a specific agent (by filename without `.md`)       |
| `--agent-cwd <path>`  | Working directory for sub-agents (default: `.`)             |
| `--help`              | Show help message                                           |

## How It Works

The runner operates a **poll-match-invoke** cycle:

1. **Poll** — each tick, poll the event queue for new events (per-agent cursor
   tracking)
2. **Match** — filter events against each agent's `listen` patterns
3. **Invoke** — for each agent with matched events, spawn a headless
   `claude --print` process with the agent's system prompt and matched events as
   the user message

Agents run concurrently but each agent processes one batch at a time (no
duplicate invocations for the same agent).

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

## Claiming Events

Agents can claim events to coordinate work. Claims are first-claim-wins — only
one worker can claim each event.

```bash
# Claim event #1
deno task events claim --worker agent-1 --event 1

# Check who claimed an event
deno task events check-claim --event 1
```

See [Event Queue CLI](event-queue.md) for the full reference.

## Supporting Skills

- `events` — a skill describing the underlying `deno task events` commands
  (`push`, `watch`, `since`, `list`, `cursor`, `claim`, `check-claim`)
- `create-agent` — a skill for helping the user define new agent files
