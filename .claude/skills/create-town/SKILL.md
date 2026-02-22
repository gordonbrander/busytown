---
name: create-town
description: Design and create a town — a group of agents that work together.
user_invocable: true
---

This skill walks through four phases to decompose a goal into collaborating
agents, design their event topology, create the agent files, and visualize the
result. Work through each phase conversationally — never skip ahead or combine
phases.

---

## Phase 1: Decompose into Agent Roles

Parse the user's goal (and any roles they suggested) and propose a set of
agents.

1. If the user suggested roles, use those as the starting point. Only suggest
   additional roles if clearly needed, and explain why.
2. For each agent, define:
   - **Name** — kebab-case, becomes the filename and worker ID
   - **Description** — one sentence, what this agent does
   - **Access level** — read-only or read-write (see presets in the
     `create-agent` skill)
3. Present the roles in a table:

   | Agent      | Description                                | Access     |
   | ---------- | ------------------------------------------ | ---------- |
   | `drafter`  | Drafts initial content from a brief        | read-write |
   | `reviewer` | Reviews drafts for quality and correctness | read-only  |

4. Guidelines for decomposition:
   - **Single responsibility** — each agent does one thing well.
   - **Think about the full lifecycle** — entry point, validation/processing
     steps, completion, and feedback loops (revision cycles).
   - **Consider claims** — if multiple instances of an agent could run, the
     agent should claim events to avoid duplicate work.
5. Ask the user to confirm the roles before proceeding to Phase 2.

---

## Phase 2: Design the Event Flow

For each agent, define the events it listens for and the events it emits.

1. For each agent, list:
   - **`listen`** — event type patterns this agent subscribes to
   - **`emits`** — event types this agent produces
2. Identify:
   - **Entry events** — pushed by the user (or an external trigger) to kick off
     the pipeline. No agent emits these.
   - **Terminal events** — emitted by agents but not listened to by any agent.
     These signal pipeline completion.
   - **Feedback loops** — where an agent's output cycles back to an earlier
     agent (e.g., review → revise → re-review).
3. Present as a table:

   | Agent      | Listens                           | Emits            |
   | ---------- | --------------------------------- | ---------------- |
   | `drafter`  | `draft.request`                   | `draft.created`  |
   | `reviewer` | `draft.created`                   | `review.created` |
   | `drafter`  | `review.created` (revise verdict) | `draft.created`  |

4. Follow the table with a plain-English flow description, e.g.:

   > A `draft.request` enters the pipeline → `drafter` produces a
   > `draft.created` → `reviewer` reviews and emits `review.created` → if the
   > verdict is "revise", `drafter` picks it up again; if "approve", the
   > pipeline is complete.

5. **Critical**: the `emits` field in agent frontmatter is what `busytown map`
   reads to build the Mermaid diagram. If `emits` is missing or incomplete, the
   map will have missing edges. Stress this to the user.
6. Ask the user to confirm the event flow before proceeding to Phase 3.

---

## Phase 3: Create the Agents

Create each agent file in `agents/` following the `create-agent` skill
conventions. Refer to that skill for the full specification — don't duplicate
its docs here, but do follow all of its rules.

For each agent file:

1. **Frontmatter** must include:
   - `description` — the one-sentence description from Phase 1
   - `listen` — the patterns from Phase 2
   - `emits` — the event types from Phase 2 (always include this)
   - `allowed_tools` — based on the access level from Phase 1. Use the presets
     from the `create-agent` skill:
     - Read-only: `Read`, `Grep`, `Glob`, `Bash(git:*)`
     - Read-write: `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash(git:*)`
     - Add `Skill` if the agent needs to invoke skills, or other Bash
       permissions as needed (e.g., `Bash(npm:*)`, `Bash(deno:*)`)

2. **System prompt body** must include:
   - A heading with the agent's name
   - A section for each event type the agent handles, with:
     - What to do when that event arrives
     - Concrete `busytown events push` examples showing the exact event type and
       payload shape
     - Claim logic if this agent may run as multiple instances
   - A guidelines section with agent-specific instructions

3. After creating all files, summarize what was created:

   | File                 | Description                |
   | -------------------- | -------------------------- |
   | `agents/drafter.md`  | Drafts content from briefs |
   | `agents/reviewer.md` | Reviews drafts for quality |

---

## Phase 4: Visualize the Town

Run `busytown map` to generate a Mermaid flowchart and verify the design.

1. Run:
   ```bash
   busytown map
   ```
   (Without `--render` — output the raw Mermaid syntax.)

2. Present the Mermaid output to the user.

3. Verify correctness:
   - All agents from Phase 1 appear as nodes
   - Entry events (from Phase 2) appear as entry nodes
   - Terminal events appear as sink nodes
   - Edges match the event flow designed in Phase 2
   - Feedback loops are visible

4. If the diagram reveals problems (missing agents, broken edges, missing
   events), offer to fix the agent files and re-run the map.

---

## Reference Example

The existing plan→code→review town demonstrates these patterns:

- **`plan`** listens for `plan.request` and `review.created`, emits
  `plan.created` and `plan.complete`
- **`code`** listens for `plan.created`, emits `code.review`
- **`review`** listens for `code.review`, emits `review.created`

The feedback loop: `review.created` with a "revise" verdict routes back to
`plan`, which revises and re-emits `plan.created`, cycling through `code` and
`review` again. `plan.complete` is the terminal event.

Entry event: `plan.request` (pushed by the user). Terminal event:
`plan.complete` (nothing listens for it).

---

## Guidelines

- **Always include `emits` in frontmatter.** This is the most common mistake.
  Without `emits`, `busytown map` cannot draw edges from the agent to downstream
  consumers.
- **Emit events for every significant action.** Starting work, completing work,
  finding issues, modifying files, encountering errors — all worth emitting.
  Even "no issues found" is a useful signal.
- **Keep system prompts concrete.** Include exact event types, example payloads,
  and step-by-step handling instructions. Vague prompts lead to unreliable
  agents.
- **Use claims for deduplication.** If multiple events could trigger the same
  agent concurrently, have the agent claim before doing work. If the claim
  fails, stop.
- **Be conversational.** Never skip phases or combine them. Each phase ends with
  user confirmation. The user may want to adjust roles, rename events, or
  add/remove agents between phases.
- **Kebab-case filenames.** `content-drafter.md`, not `contentDrafter.md`.
- **Design payloads thoughtfully.** Include enough context for downstream agents
  to do their work without re-reading event history. Paths to artifacts (plans,
  reviews, drafts) are better than inline content.
