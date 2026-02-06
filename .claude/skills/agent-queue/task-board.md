# Task Board CLI Reference

A shared task board for multi-agent coordination. Agents can create tasks, claim them with compare-and-swap semantics, and track progress. All mutations emit events to the event queue so agents can react via their listen patterns.

## Core Commands

### add

Create a new task.

```
./task-board.ts add --worker <id> --title <text> [--content <text>] [--meta <json>]
```

- Returns the created task as JSON
- Emits a `task.created` event

**Example:**
```bash
./task-board.ts add --worker agent-1 --title "Review PR #42" --content "Check for type safety"
# Output: {"id":1,"title":"Review PR #42","content":"Check for type safety","status":"open",...}
```

### claim

Claim an open task (compare-and-swap).

```
./task-board.ts claim --worker <id> --id <n>
```

- Sets `claimed_by` to the worker and `status` to `in_progress`
- Fails (exit code 1) if the task is already claimed or not open
- Re-claiming your own task is idempotent
- Emits a `task.claimed` event

**Example:**
```bash
./task-board.ts claim --worker agent-1 --id 1
# Output: {"id":1,"status":"in_progress","claimed_by":"agent-1",...}

# Another agent trying to claim the same task:
./task-board.ts claim --worker agent-2 --id 1
# stderr: {"error":"claim_failed"}  (exit code 1)
```

### unclaim

Release a claimed task. Only the current holder can unclaim.

```
./task-board.ts unclaim --worker <id> --id <n>
```

- Sets `claimed_by` to null and `status` back to `open`
- Fails (exit code 1) if you don't hold the claim
- Emits a `task.unclaimed` event

### update

Update a claimed task. Requires the worker to hold the claim.

```
./task-board.ts update --worker <id> --id <n> [--title <text>] [--content <text>] [--status <s>] [--meta <json>]
```

- Only the claim holder can update
- Emits a `task.updated` event

**Example:**
```bash
./task-board.ts update --worker agent-1 --id 1 --status done
```

### delete

Delete a claimed task. Requires the worker to hold the claim.

```
./task-board.ts delete --worker <id> --id <n>
```

- Only the claim holder can delete
- Emits a `task.deleted` event

## Query Commands

### list

List tasks as ndjson (one JSON object per line).

```
./task-board.ts list [--status <s>] [--claimed-by <id>]
```

**Example:**
```bash
./task-board.ts list --status open
# Output (one task per line):
# {"id":1,"title":"Review PR #42","status":"open",...}
# {"id":2,"title":"Fix tests","status":"open",...}
```

### get

Get a single task by ID.

```
./task-board.ts get --id <n>
```

### summary

Show task counts grouped by status.

```
./task-board.ts summary
```

**Example:**
```bash
./task-board.ts summary
# Output: {"open":3,"in_progress":1,"done":5,"blocked":0,"cancelled":0}
```

## Global Options

| Option | Description |
|--------|-------------|
| `--db <path>` | Database path (default: `events.db`) |
| `--help` | Show help message |

## Ownership Rules

| Operation | Who can do it |
|-----------|---------------|
| `add`, `list`, `get`, `claim`, `summary` | Anyone |
| `update`, `delete`, `unclaim` | Only the claim holder (`claimed_by = worker_id`) |

## Events Emitted

| Event Type | Payload | Trigger |
|---|---|---|
| `task.created` | `{ task_id, title }` | `add` |
| `task.claimed` | `{ task_id }` | `claim` |
| `task.unclaimed` | `{ task_id }` | `unclaim` |
| `task.updated` | `{ task_id, changes: {...} }` | `update` |
| `task.deleted` | `{ task_id }` | `delete` |

Agents can listen for `task.*` to react to all task board activity.

## Task Statuses

| Status | Meaning |
|--------|---------|
| `open` | Available to be claimed |
| `in_progress` | Claimed and being worked on |
| `done` | Completed |
| `blocked` | Waiting on something |
| `cancelled` | No longer needed |
