---
name: event-queue
description: How to use the worker event-queue CLI
---

# Event Queue CLI Reference

A SQLite-backed event queue for inter-worker communication. Workers can push
events and poll for new events using cursor-based pagination. Each worker
maintains its own cursor position, enabling reliable at-least-once delivery.

## Core Commands

### push

Push an event to the queue.

```
deno task event-queue push --worker <id> --type <type> [--payload <json>]
```

- `--type` is required
- `--payload` is optional JSON (defaults to `{}`)
- Returns `{ id }` on success

**Example:**

```bash
deno task event-queue push --worker agent-1 --type task.created --payload '{"name":"foo"}'
# Output: {"id":1}
```

### watch

Poll for new events and stream ndjson to stdout.

```
deno task event-queue watch --worker <id> [--poll <seconds>] [--omit_worker <id>]
```

- Streams events as ndjson (one JSON object per line)
- Auto-advances cursor after each poll
- Runs indefinitely until interrupted
- Default poll interval: 3 seconds

**Example:**

```bash
deno task event-queue watch --worker agent-1 --poll 2
# Output (streaming):
# {"id":1,"timestamp":1234567890,"type":"task.created","worker_id":"agent-2","payload":{"name":"foo"}}
# {"id":2,"timestamp":1234567891,"type":"task.done","worker_id":"agent-2","payload":{}}
```

## Other Commands

### since

Get the current cursor position for a worker.

```
deno task event-queue since --worker <id>
```

**Example:**

```bash
deno task event-queue since --worker agent-1
# Output: {"worker_id":"agent-1","since":5}
```

### events

Fetch events after a given ID. Outputs ndjson (one event per line).

```
deno task event-queue events [--since <id>] [--tail <n>] [--limit <n>] [--omit-worker <id>] [--worker <id>] [--type <type>]
```

- `--since <id>` — event ID to start after (forward scan, ascending; default:
  `0`)
- `--tail <n>` — show the last n events (output ascending)
- `--limit <n>` — maximum number of events for forward scan (default: `100`)
- `--worker <id>` — only show events from this worker
- `--omit-worker <id>` — exclude events from this worker
- `--type <type>` — only show events of this type (`*` = all, default: `*`)

**Example:**

```bash
deno task event-queue events --since 0 --limit 10
# Output (one event per line):
# {"id":1,"timestamp":1234567890,"type":"task.created","worker_id":"agent-1","payload":{}}
# {"id":2,"timestamp":1234567891,"type":"task.done","worker_id":"agent-1","payload":{}}

# Filter to a specific worker:
deno task event-queue events --since 0 --worker agent-1

# Filter by event type:
deno task event-queue events --since 0 --type task.created

# Show the last 5 events:
deno task event-queue events --tail 5
```

### cursor

Manually set the cursor position for a worker.

```
deno task event-queue cursor --worker <id> --set <event_id>
```

**Example:**

```bash
deno task event-queue cursor --worker agent-1 --set 10
# Output: {"worker_id":"agent-1","since":10}
```

### claim

Claim an event (first-claim-wins). Claiming lets workers coordinate over who
should claim an event.

```
deno task event-queue claim --worker <id> --event <id>
```

- Returns `{"claimed":true}` on success
- Returns `{"claimed":false,"claimant":"<worker_id>"}` if already claimed

**Example:**

```bash
deno task event-queue claim --worker agent-1 --event 5
# Output: {"claimed":true}

deno task event-queue claim --worker agent-2 --event 5
# Output: {"claimed":false,"claimant":"agent-1"}
```

### check-claim

Check the claim status of an event.

```
deno task event-queue check-claim --event <id>
```

**Example:**

```bash
deno task event-queue check-claim --event 5
# Output: {"event_id":5,"worker_id":"agent-1","claimed_at":1234567890}

deno task event-queue check-claim --event 99
# Output: {"event_id":99,"claimed":false}
```

## Global Options

| Option        | Description                          |
| ------------- | ------------------------------------ |
| `--db <path>` | Database path (default: `events.db`) |
| `--help`      | Show help message                    |

## Examples

**Push an event and watch for responses:**

```bash
# Terminal 1: Watch for events
deno task event-queue watch --worker consumer --omit_worker consumer

# Terminal 2: Push events
deno task event-queue push --worker producer --type ping --payload '{"msg":"hello"}'
```

**Read all events from the beginning:**

```bash
deno task event-queue events --since 0
```

**Reset a worker's cursor to replay events:**

```bash
deno task event-queue cursor --worker agent-1 --set 0
```
