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

### Install

```bash
# Install the `busytown` command globally
deno task install
```

This creates a `busytown` command you can run from any directory.

### 1. Start the agent runner

```bash
# Run in foreground
busytown run

# Or start as a background daemon
busytown start
```

### 2. Push an event

```bash
busytown plan prds/my-feature.md
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

    busytown events push --type summary.created --worker summarizer \
      --payload '{"path": "summaries/<filename>.md"}'
```

Each agent runs as a headless Claude Code subprocess (`claude --print`),
sandboxed to only the tools you allow.

The agent's markdown body becomes its system prompt. The runner automatically
injects context about the event queue CLI so agents know how to push events.

**Fields:**

- `type` — Agent type (default `claude`)
- `description` — What the agent does (included in its system prompt context)
- `listen` — Event types to react to. Supports exact match (`plan.created`),
  prefix glob (`file.*`), or wildcard (`*`)
- `allowed_tools` — Claude Code tools the agent can use (e.g. `Read`, `Write`,
  `Edit`, `Grep`, `Glob`, `Bash(git:*)`). Only applies to `claude` agents.
- `model` — Claude model to use (e.g. `haiku`, `sonnet`, `opus`, or a full model
  ID). Optional; defaults to whatever model the user has configured globally.
- `effort` — Thinking effort level: `low`, `medium`, or `high`. Optional;
  defaults to the CLI default.

### Shell agents

For lightweight tasks that don't need an LLM — formatting, linting, running
scripts — use `type: shell` instead. The text body becomes a shell script (run
via `sh -c`) with Mustache-style template placeholders. The body can be a single
command or a full multi-line script — variables, conditionals, loops, pipes, and
heredocs all work:

```markdown
---
type: shell
listen:
  - "file.created"
---

path={{event.payload.path}} echo "Processing $path"
deno fmt "$path" busytown events push --type file.formatted --worker formatter
```

**Template syntax:**

- `{{key}}` — Resolves the value and **shell-escapes** it (single-quote
  wrapping). Safe by default.
- `{{{key}}}` — Resolves the value and inserts it **raw** (no escaping). Use
  when you need unquoted paths or command fragments.
- Dot paths like `{{event.payload.path}}` walk nested objects.
- Missing keys resolve to an empty string.

The template context contains the full event object as `event`, so any field
from the event (id, type, timestamp, worker_id, payload) is available.

Shell agent stdout and stderr are logged to `logs/<agent-id>.log`, the same as
Claude agents.

## CLI

After installing (`deno task install`), use `busytown` from any directory:

```bash
busytown <command> [options]
```

### Event queue commands

```bash
# Push an event
busytown events push --type my.event --worker my-script --payload '{"key":"value"}'

# Query events
busytown events list --type plan.* --limit 10 --tail

# Watch for new events (streams ndjson)
busytown events watch --worker my-watcher

# Check a worker's cursor position
busytown events cursor --worker my-agent

# Claim an event
busytown events claim --event 42 --worker my-agent

# Check who claimed an event
busytown events check-claim --event 42
```

### Agent runner commands

```bash
busytown <command> [options]

# Commands
run                    # Run poll loop in foreground
start                  # Start as background daemon
stop                   # Stop the daemon
restart                # Restart the daemon
status                 # Check if daemon is running
plan <prd-file>        # Push a plan.request event

# Options
--agents-dir <path>    # Agent definitions directory (default: agents/)
--db <path>            # Database path (default: events.db)
--poll <ms>            # Poll interval in ms (default: 1000)
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
busytown run --watch src --watch docs

# Exclude patterns (glob syntax)
busytown run --exclude '**/dist/**' --exclude '**/build/**'
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
