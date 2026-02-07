# Creating Agents

Agents are markdown files with YAML frontmatter that define a persona and event subscriptions. The agent runner loads these files, matches incoming events to each agent's listen patterns, and invokes matching agents as headless Claude Code instances.

## File Location

Agents live in `agents/` (configurable via `--agents-dir`). The filename (without `.md`) becomes the agent's **worker ID**.

```
agents/
  code-reviewer.md    # worker ID: "code-reviewer"
  test-runner.md      # worker ID: "test-runner"
```

Use kebab-case for filenames.

## Frontmatter Format

```yaml
---
description: Brief description of the agent's purpose
listen:
  - "event.pattern"
allowed_tools:
  - "Read"
  - "Grep"
---
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | yes | Brief description of the agent's purpose. Included in the agent's system prompt header. |
| `listen` | string[] | no | Event type patterns to subscribe to. Defaults to `["*"]` if omitted. |
| `allowed_tools` | string[] | no | Tool allowlist. `["*"]` grants all tools. If omitted, the agent can only push events. |

## Listen Patterns

| Pattern | Matches | Example |
|---------|---------|---------|
| `"*"` | All events (except from self) | Catches everything |
| `"task.created"` | Exact event type | Only `task.created` events |
| `"task.*"` | Prefix glob | `task.created`, `task.done`, `task.failed`, etc. |

An agent is invoked when **any** of its listen patterns match an incoming event. Events emitted by the agent itself are always excluded from wildcard (`*`) matching.

## Tool Permissions

By default, agents can only push events. Use `allowed_tools` to grant access to additional Claude Code tools. Use `["*"]` to grant access to all tools.

File tools (Read, Write, Edit, Glob, Grep) are restricted to the project directory — the working directory where the agent runner was started. Agents cannot access files outside this directory.

### Allowlist Format

| Entry | Meaning |
|-------|---------|
| `"*"` | Allow all tools (no restrictions) |
| `"Read"` | Allow the Read tool |
| `"Bash(git:*)"` | Allow Bash only for commands starting with `git` |
| `"Bash(npm test:*)"` | Allow Bash only for `npm test` commands |

The runner automatically injects permission to run `event-queue.ts push` via Bash, so you never need to include that yourself.

### Common Presets

**Read-only** (search code, run git, push events):
```yaml
allowed_tools:
  - "Read"
  - "Grep"
  - "Glob"
  - "Bash(git:*)"
```

**Read-write** (also edit files):
```yaml
allowed_tools:
  - "Read"
  - "Grep"
  - "Glob"
  - "Edit"
  - "Write"
  - "Bash(git:*)"
```

## System Prompt Body

Everything below the closing `---` is the agent's system prompt. Write it as if you are instructing a Claude instance:

```markdown
---
description: Reviews code for issues
listen:
  - "file.change"
---

When triggered by file changes, review the modified files for:

1. Type safety issues
2. Error handling gaps
3. Code smells
```

## Emitting Events

Agents should **push events for every significant action**. This is how agents communicate with each other and how you can observe the system's behavior.

### When to Emit

- **Starting work** — signal that you've begun processing (`review.started`, `build.started`)
- **Completing work** — report results (`review.completed`, `test.passed`)
- **Reporting findings** — individual items of interest (`issue.found`, `suggestion.created`)
- **Errors** — something went wrong (`review.failed`, `build.error`)
- **File modifications** — you changed a file (`file.modified`, `file.created`)

### Event Type Conventions

Use dot-separated namespaces: `<domain>.<action>`

```
review.started
review.completed
issue.found
file.modified
test.passed
build.failed
```

### Pushing Events from an Agent

The agent runner injects the `event-queue.ts push` command into each agent's system prompt. Agents can push events by running:

```bash
scripts/event-queue.ts push --worker <agent-id> --db events.db --data '{"type":"review.completed","payload":{"files":["src/app.ts"],"issues":0}}'
```

Include relevant data in the `payload` so downstream agents have context.

## Complete Example

`agents/code-reviewer.md`:

```markdown
---
description: Reviews TypeScript code changes for potential issues
listen:
  - "file.change"
---

# Code Reviewer Agent

## Instructions

When triggered by file changes, review the modified TypeScript files for:

1. **Type safety issues** - Missing types, any usage, unsafe casts
2. **Error handling** - Unhandled promises, missing try/catch
3. **Code smells** - Long functions, deep nesting, code duplication

Provide a brief summary of findings. If no issues found, confirm the code looks good.
```

## Using the Task Board

Agents can coordinate work through a shared task board. The agent runner automatically injects task board CLI instructions into each agent's system prompt.

### Workflow

1. **Create tasks** — break work into discrete units with `task-board add`
2. **Claim before working** — use `task-board claim` to atomically take ownership
3. **Handle claim failures** — if a claim fails (exit code 1), the task is already taken; try another
4. **Update status** — mark tasks `done`, `blocked`, etc. with `task-board update`
5. **Listen for task events** — subscribe to `task.*` to react to board changes

### Example Agent Using the Task Board

```markdown
---
description: Picks up open review tasks and reviews the code
listen:
  - "task.created"
allowed_tools:
  - "Read"
  - "Grep"
  - "Glob"
---

When a new task is created, check if it's a code review task.
If so, claim it, perform the review, then mark it done.

If the claim fails, another agent already took it — move on.
```

### Task Board Permissions

The runner automatically grants Bash permission for `task-board.ts` commands, just like it does for `event-queue.ts`. You don't need to add it to `allowed_tools`.

## Tips

- **Single responsibility** — each agent should do one thing well. Create multiple focused agents rather than one monolithic one.
- **Always emit events** — other agents (and humans) rely on the event stream to understand what happened. Even a "no issues found" result is worth emitting.
- **Use specific listen patterns** — prefer `"task.*"` or exact matches over `"*"` to avoid unnecessary invocations.
- **Kebab-case filenames** — `code-reviewer.md`, not `codeReviewer.md` or `code_reviewer.md`.
