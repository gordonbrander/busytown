# Architecture

busytown is a multi-agent coordination framework. Agents are Claude Code
instances that communicate through a shared SQLite event queue. No agent knows
about any other agent — they only know about events.

## Overview

```
┌──────────┐    push     ┌─────────────────┐    dispatch    ┌───────────┐
│  User /  │───────────▸ │  SQLite Event   │ ─────────────▸ │  Agent    │
│  Script  │             │  Queue          │                │  (Claude) │
└──────────┘             │                 │ ◂───────────── └───────────┘
                         │  events         │    push new
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

There are four moving parts:

1. **Event queue** — a SQLite database with three tables
2. **Agent runner** — a poll loop that dispatches events to agents
3. **Agents** — markdown files that define Claude Code workers
4. **FS watcher** — pushes file change events into the queue

## Event Queue

The event queue is the single source of truth. It lives in a SQLite database
(default: `events.db`) with WAL mode enabled for concurrent access.

### Schema

**events** — the append-only event log.

| Column    | Type    | Description                        |
| --------- | ------- | ---------------------------------- |
| id        | INTEGER | Auto-incrementing primary key      |
| timestamp | INTEGER | Unix epoch seconds (set by SQLite) |
| type      | TEXT    | Dot-separated event type           |
| worker_id | TEXT    | ID of the worker that pushed it    |
| payload   | TEXT    | JSON string (defaults to `{}`)     |

**worker_cursors** — each worker's position in the event stream.

| Column    | Type    | Description                      |
| --------- | ------- | -------------------------------- |
| worker_id | TEXT    | Primary key                      |
| since     | INTEGER | ID of the last processed event   |
| timestamp | INTEGER | When the cursor was last updated |

**claims** — first-claim-wins deduplication.

| Column     | Type    | Description                       |
| ---------- | ------- | --------------------------------- |
| event_id   | INTEGER | Primary key (one claim per event) |
| worker_id  | TEXT    | Who claimed it                    |
| claimed_at | INTEGER | Unix epoch seconds                |

### Event types

Event types use dot-separated namespaces: `entity.action`. Examples:

- `plan.request`, `plan.created`
- `code.review`
- `review.created`
- `file.create`, `file.modify`, `file.delete`, `file.rename`
- `claim.created`, `cursor.create`

### Core operations

**pushEvent(db, workerId, type, payload)** — Inserts an event. Returns the event
with its auto-generated ID and timestamp.

**getEventsSince(db, options)** — Queries events after a given ID. Supports
filtering by worker, type, and tail mode.

**getNextEvent(db, workerId)** — Gets the worker's cursor, fetches the next
single event after the cursor. This is the primary read path.

**getOrCreateCursor(db, workerId)** — For existing workers, returns their
cursor. For new workers, creates a cursor at the current tail so they only see
future events (play-from-now semantics).

**claimEvent(db, workerId, eventId)** — Uses `INSERT OR IGNORE` on the claims
primary key. Only the first caller wins. Pushes a `claim.created` event on
success.

### Delivery guarantees

- **At-most-once.** A worker's cursor advances immediately when an event is
  read, before the effect runs. If processing fails, the event is not
  re-delivered. The SQLite database is the sole source of truth for ordering.
- **Ordered reads.** Events are read in ID order (ascending), one at a time.
  Effects are processed serially — the worker waits for each effect to complete
  before reading the next event.
- **Play-from-now.** New workers start from the current tail, not from the
  beginning of history.

## Agent Runner

The agent runner (`lib/runner.ts`) starts the worker system and registers
agents. At startup it:

1. Opens the SQLite database
2. Loads all agent definitions from `agents/`
3. Spawns a worker for each agent (plus a `_stdout` worker that logs all events
   as NDJSON)
4. Starts the filesystem watcher

### Worker system (`lib/worker.ts`)

The worker system (`createSystem`) manages a set of independently polling
workers. Each worker runs a `forkWorker` loop:

1. Read the worker's cursor from the database
2. Fetch the next single event after the cursor
3. If no event, sleep for `pollIntervalMs` and retry
4. **Immediately advance the cursor** past the event (at-most-once delivery)
5. If the event matches the worker's `listen` patterns, **await the effect**
   (serial processing)
6. Yield to the event loop and repeat from step 1

Workers process events serially — each effect must complete before the worker
reads the next event. This follows the actor model: one message at a time, in
order.

## Agents

An agent is a markdown file in `agents/` with YAML frontmatter:

```markdown
---
description: What this agent does
listen:
  - "plan.request"
  - "file.*"
allowed_tools:
  - "Read"
  - "Write"
  - "Bash(git:*)"
---

System prompt goes here. The runner injects event queue CLI instructions
automatically.
```

### Frontmatter fields

- **description** — included in the agent's system prompt for self-awareness
- **listen** — event types to react to (see matching below)
- **allowed_tools** — Claude Code tools the agent can use. The runner
  auto-injects `Bash(busytown events:*)` so agents can always push events and
  claim work.

### Listen matching

Three patterns, checked in order:

| Pattern        | Matches                                                     |
| -------------- | ----------------------------------------------------------- |
| `plan.created` | Exact match on event type                                   |
| `file.*`       | Prefix glob — matches `file.create`, `file.modify`, etc.    |
| `*`            | Wildcard — matches everything except the agent's own events |

### Agent invocation

Each agent runs as a headless Claude Code subprocess:

```
claude --print --system-prompt <prompt> --verbose --output-format stream-json --allowedTools <tools>
```

The triggering event is passed as JSON on stdin. Output streams to
`logs/{agent_id}.log`.

The system prompt is assembled by the runner: a header with the agent's ID,
description, and event queue CLI instructions, followed by the agent's markdown
body.

## FS Watcher

The filesystem watcher (`lib/fs-watcher.ts`) monitors directories with
`Deno.watchFs` and pushes events to the queue:

| FS event | Queue event   |
| -------- | ------------- |
| create   | `file.create` |
| modify   | `file.modify` |
| remove   | `file.delete` |
| rename   | `file.rename` |

Events are debounced (200ms) and filtered through exclude patterns. Common paths
are excluded by default: `.git`, `node_modules`, `.DS_Store`, `*.pid`, `*.log`,
`events.db*`.

The watcher uses worker_id `"fs"` and includes `{path: <relative_path>}` in the
payload.

## Claims

Claims prevent duplicate work when multiple agents listen for the same event
type. The pattern:

1. Agent receives an event
2. Agent calls `claimEvent(db, agentId, eventId)`
3. If it returns `true`, proceed. If `false`, another agent got there first —
   stop.

Under the hood, `INSERT OR IGNORE` on the claims table primary key ensures only
the first writer wins. This is atomic at the SQLite level.

## CLI

busytown ships a unified CLI installed globally via `deno task install`. This
creates a `busytown` command usable from any directory.

### Event queue commands

```bash
busytown events <command> [--db <path>]
```

| Command       | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `push`        | Push an event (`--worker`, `--type`, `--payload`)                   |
| `list`        | Query events (`--since`, `--limit`, `--tail`, `--type`, `--worker`) |
| `watch`       | Stream new events as NDJSON (`--worker`, `--poll`)                  |
| `cursor`      | Get a worker's cursor position (`--worker`)                         |
| `set-cursor`  | Set a worker's cursor (`--worker`, `--set`)                         |
| `claim`       | Claim an event (`--worker`, `--event`)                              |
| `check-claim` | Check who claimed an event (`--event`)                              |

### Agent runner commands

```bash
busytown <command> [options]
```

| Command   | Description                 |
| --------- | --------------------------- |
| `run`     | Run poll loop in foreground |
| `start`   | Start as background daemon  |
| `stop`    | Stop the daemon             |
| `restart` | Restart the daemon          |
| `status`  | Check if daemon is running  |
| `plan`    | Push a plan.request event   |

Options: `--agents-dir`, `--db`, `--poll`, `--agent-cwd`, `--watch`,
`--exclude`.

## Design principles

**Events are the only coupling.** Agents don't import each other, call each
other, or share state beyond the event queue and the filesystem. You can add,
remove, or swap agents without changing anything else.

**Agents are just markdown.** An agent definition is a versioned text file. The
body is the system prompt, the frontmatter is config. Easy to read, review, and
iterate on.

**The queue is append-only.** Events are never updated or deleted. The full
history is always available. Cursors let each worker maintain its own read
position independently.

**Minimal schema.** Three tables, no migrations, no external dependencies beyond
SQLite. The queue opens with `CREATE TABLE IF NOT EXISTS` so setup is automatic.
