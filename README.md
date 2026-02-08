# busytown

_A town full of busy little guys who do things._

**busytown** is a multi-agent coordination framework built around a shared
SQLite event queue. Each agent is a separate Claude Code instance. Agents listen
for events, react to them, and push new events, forming an asynchronous pipeline
where no agent needs to know about any other agent, only about the events.

<p><img src="./busytown.png" src="A town full of busy little guys who do things" /></p>

## How it works

Everything is stored in a single SQLite database (`events.db`). Events are
simple JSON objects:

```json
{
  "id": 1,
  "type": "plan.request",
  "timestamp": "...",
  "worker_id": "user",
  "payload": { "prd_path": "prds/my-feature.md" }
}
```

The agent runner polls the queue and dispatches events to matching agents. Each
agent:

- **Listens** for specific event types (exact match, prefix glob like `file.*`,
  or wildcard `*`)
- **Reacts** by reading files, writing code, producing artifacts
- **Pushes** new events to notify other agents of what it did
- **Claims** events when needed, so only one agent acts on a given event

Agents can also use the filesystem as a shared workspace for saving memories,
plans, WIP, etc.

## Architecture

```
┌──────────┐    push     ┌─────────────────┐    dispatch    ┌───────────┐
│  User /  │───────────▸ │  SQLite Event   │ ─────────────▸ │  Agent    │
│  Script  │             │  Queue          │                │  (Claude) │
└──────────┘             │                 │ ◂───────────── └───────────┘
                         │  events table   │    push new
                         │  worker_cursors │    events
                         │  claims         │
                         └─────────────────┘
                               ▲     │
                               │     ▼
                         ┌───────────┐
                         │  Agent    │
                         │  (Claude) │
                         └───────────┘
```

## Getting started

**Prerequisites:** [Deno](https://deno.land/) and
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed.

### 1. Start the agent runner

```bash
# Run in foreground
deno task runner run

# Or start as a background daemon
deno task runner start
```

### 2. Push an event

```bash
# Or use the shortcut
deno task plan prds/my-feature.md
```

### 3. Watch it go

The runner picks up the event, dispatches it to matching agents, and each agent
pushes new events that trigger the next stage. Every event is streamed to the
terminal as ndjson.

## Included agents

The `agents/` directory ships with a **plan-code-review loop**:

| Agent      | Listens for                      | Does                                                                          | Pushes                                        |
| ---------- | -------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| **plan**   | `plan.request`, `review.created` | Reads a PRD, explores the codebase, writes an implementation plan to `plans/` | `plan.created`                                |
| **code**   | `plan.created`                   | Follows the plan to implement code changes                                    | `code.review`                                 |
| **review** | `code.review`                    | Reviews the diff for correctness, writes a review to `reviews/`               | `review.created` (verdict: approve or revise) |

If the reviewer says "revise", the plan agent picks it up and the loop continues
until approval.

## Writing your own agent

An agent is a markdown file in `agents/` with YAML frontmatter:

```markdown
---
description: Summarizes new documents
listen:
  - "file.created"
allowed_tools:
  - "Read"
  - "Write"
---

You are a summarizer agent. When a new file is created, read it and write a
summary to `summaries/<filename>.md`.

After writing the summary, push an event:

    deno task events push --type summary.created --worker summarizer \
      --payload '{"path": "summaries/<filename>.md"}'
```

**Fields:**

- `description` — What the agent does (included in its system prompt context)
- `listen` — Event types to react to. Supports exact match (`plan.created`),
  prefix glob (`file.*`), or wildcard (`*`)
- `allowed_tools` — Claude Code tools the agent can use (e.g. `Read`, `Write`,
  `Edit`, `Grep`, `Glob`, `Bash(git:*)`)

The agent's markdown body becomes its system prompt. The runner automatically
injects context about the event queue CLI so agents know how to push events.

Each agent runs as a headless Claude Code subprocess (`claude --print`),
sandboxed to only the tools you allow.

## Event queue CLI

The event queue has a full CLI for manual interaction and scripting:

```bash
# Push an event
deno task events push --type my.event --worker my-script --payload '{"key":"value"}'

# Query events
deno task events list --type plan.* --limit 10 --tail

# Watch for new events (streams ndjson)
deno task events watch --worker my-watcher --type file.*

# Check a worker's cursor position
deno task events since --worker my-agent

# Claim an event
deno task events claim --event-id 42 --worker my-agent

# Check who claimed an event
deno task events check-claim --event-id 42
```

## Agent runner CLI

```bash
deno task runner <command> [options]

# Commands
run                    # Run poll loop in foreground
start                  # Start as background daemon
stop                   # Stop the daemon
restart                # Restart the daemon
status                 # Check if daemon is running

# Options
--agents-dir <path>    # Agent definitions directory (default: agents/)
--db <path>            # Database path (default: events.db)
--poll <ms>            # Poll interval in ms (default: 5000)
--agent <name>         # Run only a specific agent
--agent-cwd <path>     # Working directory for agents (default: .)
--watch <paths>        # Paths to watch for FS changes (default: .)
--exclude <patterns>   # Glob patterns to exclude from watching
```

## File system watcher

The runner watches directories for file system changes and pushes
`file.created`, `file.modified`, and `file.deleted` events. By default it
watches the current directory (`.`).

```bash
# Watch specific directories
deno task runner run --watch src --watch docs

# Exclude patterns (glob syntax)
deno task runner run --exclude '**/dist/**' --exclude '**/build/**'
```

Common paths (`.git`, `node_modules`, `.DS_Store`, `*.pid`, `*.log`,
`events.db*`) are excluded automatically.

This lets you build agents that react to file changes — useful for
auto-indexing, summarization, or triggering builds.

## Key concepts

- **Cursor-based delivery** — Each worker maintains its own cursor in the queue,
  enabling reliable at-least-once delivery. Workers only see events newer than
  their cursor.
- **First-claim-wins** — When multiple agents listen for the same event type,
  `claimEvent()` ensures only one agent processes a given event.
- **Namespace wildcards** — Event types use dot-separated namespaces. Agents can
  listen for `file.*` to catch `file.created`, `file.modified`, etc.
- **Agents are just markdown** — Agent definitions are markdown files. The body
  is the system prompt, the frontmatter is config. Easy to version, review, and
  iterate on.
- **No agent coupling** — Agents don't know about each other. They only know
  about events. You can add, remove, or swap agents without changing anything
  else.

## License

MIT
