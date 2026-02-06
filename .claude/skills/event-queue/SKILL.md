---
name: event-queue
description: SQLite-backed event queue for inter-worker communication with cursor-based polling.
user_invocable: false
---

# Event Queue

A SQLite-backed event queue for inter-worker communication. Workers can push events and poll for new events using cursor-based pagination. Each worker maintains its own cursor position, enabling reliable at-least-once delivery.

## Core Commands

### push

Push an event to the queue.

```
event-queue push --worker <id> [--data <json>]
```

- Accepts `{ type, payload }` via `--data` or stdin
- Returns `{ id }` on success

**Example:**
```bash
event-queue push --worker agent-1 --data '{"type":"task.created","payload":{"name":"foo"}}'
# Output: {"id":1}
```

### watch

Poll for new events and stream ndjson to stdout.

```
event-queue watch --worker <id> [--poll <seconds>] [--omit_worker <id>]
```

- Streams events as ndjson (one JSON object per line)
- Auto-advances cursor after each poll
- Runs indefinitely until interrupted
- Default poll interval: 3 seconds

**Example:**
```bash
event-queue watch --worker agent-1 --poll 2
# Output (streaming):
# {"id":1,"timestamp":1234567890,"type":"task.created","worker_id":"agent-2","payload":{"name":"foo"}}
# {"id":2,"timestamp":1234567891,"type":"task.done","worker_id":"agent-2","payload":{}}
```

## Other Commands

### since

Get the current cursor position for a worker.

```
event-queue since --worker <id>
```

**Example:**
```bash
event-queue since --worker agent-1
# Output: {"worker_id":"agent-1","since":5}
```

### events

Fetch events after a given ID. Outputs ndjson (one event per line).

```
event-queue events --since <id> [--limit <n>] [--omit_worker <id>]
```

**Example:**
```bash
event-queue events --since 0 --limit 10
# Output (one event per line):
# {"id":1,"timestamp":1234567890,"type":"task.created","worker_id":"agent-1","payload":{}}
# {"id":2,"timestamp":1234567891,"type":"task.done","worker_id":"agent-1","payload":{}}
```

### cursor

Manually set the cursor position for a worker.

```
event-queue cursor --worker <id> --set <event_id>
```

**Example:**
```bash
event-queue cursor --worker agent-1 --set 10
# Output: {"worker_id":"agent-1","since":10}
```

## Global Options

| Option | Description |
|--------|-------------|
| `--db <path>` | Database path (default: `events.db`) |
| `--help` | Show help message |

## Examples

**Push an event and watch for responses:**
```bash
# Terminal 1: Watch for events
event-queue watch --worker consumer --omit_worker consumer

# Terminal 2: Push events
event-queue push --worker producer --data '{"type":"ping","payload":{"msg":"hello"}}'
```

**Read all events from the beginning:**
```bash
event-queue events --since 0
```

**Reset a worker's cursor to replay events:**
```bash
event-queue cursor --worker agent-1 --set 0
```
