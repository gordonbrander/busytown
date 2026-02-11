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
- `file.created`, `file.modified`, `file.deleted`
- `agent.start`, `agent.finish`, `agent.error`
- `claim.created`, `cursor.create`

### Core operations

**pushEvent(db, workerId, type, payload)** — Inserts an event. Returns the event
with its auto-generated ID and timestamp.

**getEventsSince(db, options)** — Queries events after a given ID. Supports
filtering by worker, type, and tail mode.

**pollEvents(db, workerId, limit, omitWorkerId)** — Convenience: gets the
worker's cursor, fetches new events, advances the cursor. This is the primary
read path.

**getOrCreateCursor(db, workerId)** — For existing workers, returns their
cursor. For new workers, creates a cursor at the current tail so they only see
future events (play-from-now semantics).

**claimEvent(db, workerId, eventId)** — Uses `INSERT OR IGNORE` on the claims
primary key. Only the first caller wins. Pushes a `claim.created` event on
success.

### Delivery guarantees

- **At-least-once.** A worker's cursor only advances after events are fetched.
  If processing fails mid-batch, the cursor stays put and those events will be
  re-delivered on the next poll.
- **Ordered.** Events are delivered in ID order (ascending) within a poll batch.
- **Play-from-now.** New workers start from the current tail, not from the
  beginning of history.

## Agent Runner

The agent runner (`lib/agent-runner.ts`) is an infinite loop that polls the
event queue and dispatches events to matching agents. It runs two concurrent
tasks:

1. **Poll loop** — loads agents, polls events, dispatches matches
2. **FS watcher** — monitors the filesystem and pushes `file.*` events

### Independent polling loops

At startup, the runner loads all agent definitions and launches independent
concurrent loops via `Promise.all`:

- **`pollEvents`** — polls the `_stdout` cursor and emits new events as NDJSON
  to stdout (for external consumers)
- **`pollAgent`** (one per agent) — polls events, matches against the agent's
  `listen` patterns, and invokes the agent subprocess

Each loop runs independently. A slow agent no longer blocks stdout or other
agents.

### Event dispatch (pollAgent)

Each agent's loop:

1. Get or create the agent's cursor
2. Fetch up to 100 events after the cursor, excluding the agent's own events
   (prevents self-triggering)
3. For each event, check if it matches the agent's `listen` patterns
4. If it matches: push `agent.start`, spawn a Claude Code instance, then push
   `agent.finish` or `agent.error`
5. Advance the cursor past every event (matched or not)
6. If any events were processed, immediately re-poll (mailbox drain); otherwise
   sleep for `pollIntervalMs`

Events within a single agent are processed serially. Different agents run their
loops concurrently.

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
| `file.*`       | Prefix glob — matches `file.created`, `file.modified`, etc. |
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

### Self-exclusion

An agent never sees its own events. The runner uses `omitWorkerId: agent.id`
when fetching events, so an agent's outputs (including lifecycle events) are
skipped during matching. The cursor still advances past them.

### Lifecycle events

The runner pushes these automatically around each agent invocation:

| Event          | Payload                             |
| -------------- | ----------------------------------- |
| `agent.start`  | `{event_id, event_type}`            |
| `agent.finish` | `{event_id, event_type}`            |
| `agent.error`  | `{event_id, event_type, exit_code}` |

## FS Watcher

The filesystem watcher (`lib/fs-watcher.ts`) monitors directories with
`Deno.watchFs` and pushes events to the queue:

| FS event | Queue event     |
| -------- | --------------- |
| create   | `file.created`  |
| modify   | `file.modified` |
| remove   | `file.deleted`  |

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
