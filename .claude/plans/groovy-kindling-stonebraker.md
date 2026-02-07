# Replace task board with event claims

## Context

The existing "task board" feature provides a separate `tasks` table with CRUD,
compare-and-swap claims, and status tracking. This is being replaced with a
simpler mechanism: workers claim **events** directly. Claims are tied to
specific events in the log, there's no separate entity lifecycle to manage, and
no need for unclaim/revoke semantics. A `claims` table provides atomic
first-claim-wins via PRIMARY KEY constraint, and each successful claim emits a
`claim.created` event for observability.

## Design

**New `claims` table:**

```sql
CREATE TABLE IF NOT EXISTS claims (
  event_id INTEGER PRIMARY KEY,
  worker_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL DEFAULT (unixepoch())
)
```

**New library functions** (`lib/event-queue.ts`):

- `claimEvent(db, workerId, eventId)` → `boolean` — `INSERT OR IGNORE`, emit
  `claim.created` on success
- `getClaimant(db, eventId)` → `{ worker_id, claimed_at } | undefined`

**New CLI commands** (`scripts/event-queue.ts`):

- `claim --worker <id> --event <id>` → `{"claimed":true}` or
  `{"claimed":false,"claimant":"..."}`
- `check-claim --event <id>` → `{"event_id":N,"worker_id":"...","claimed_at":N}`
  or `{"event_id":N,"claimed":false}`

## Files to delete

- `lib/task-board.ts`
- `scripts/task-board.ts`
- `.claude/skills/agent-queue/task-board.md`

## Files to modify

### 1. `lib/db.ts`

Remove the `tasks` table creation and its indexes (lines 47–64). Add the
`claims` table. Update docstring. Keep `transaction` helper.

### 2. `lib/event-queue.ts`

Add `claimEvent` and `getClaimant` exports. Import `transaction` from `./db.ts`.
`claimEvent` wraps INSERT + pushEvent in a transaction.

### 3. `scripts/event-queue.ts`

Add `claim` and `check-claim` subcommands. Import `claimEvent` and
`getClaimant`.

### 4. `lib/agent-runner.ts`

Replace "Task board" section in `buildSystemPrompt` (lines 122–137) with
"Claiming events" section showing the two new commands. Remove
`"Bash(deno task task-board:*)"` from `buildToolArgs` (line 154).

### 5. `deno.json`

Remove the `"task-board"` task entry.

### 6. `.claude/skills/agent-queue/SKILL.md`

Replace "Task Board" section with "Claiming Events". Remove task-board from
"Supporting References".

### 7. `.claude/skills/agent-queue/create-agent.md`

Replace "Using the Task Board" section (lines 162–195) with "Claiming Events"
workflow.

### 8. `.claude/skills/agent-queue/event-queue.md`

Add `claim` and `check-claim` command documentation with examples.

## Verification

```bash
rm -f /tmp/test-claims.db

# Push two events
deno run --allow-read --allow-write scripts/event-queue.ts push --db /tmp/test-claims.db --worker alice --data '{"type":"work.requested"}'
deno run --allow-read --allow-write scripts/event-queue.ts push --db /tmp/test-claims.db --worker alice --data '{"type":"work.requested"}'

# First claim wins
deno run --allow-read --allow-write scripts/event-queue.ts claim --db /tmp/test-claims.db --worker bob --event 1
# => {"claimed":true}

# Second claim fails
deno run --allow-read --allow-write scripts/event-queue.ts claim --db /tmp/test-claims.db --worker carol --event 1
# => {"claimed":false,"claimant":"bob"}

# Check claim status
deno run --allow-read --allow-write scripts/event-queue.ts check-claim --db /tmp/test-claims.db --event 1
# => {"event_id":1,"worker_id":"bob","claimed_at":...}

deno run --allow-read --allow-write scripts/event-queue.ts check-claim --db /tmp/test-claims.db --event 2
# => {"event_id":2,"claimed":false}

# Verify claim.created event emitted
deno run --allow-read --allow-write scripts/event-queue.ts events --db /tmp/test-claims.db --type claim.created
# => one event with payload {"event_id":1}
```
