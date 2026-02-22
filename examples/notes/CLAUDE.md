# busytown-notes

A self-gardening Zettelkasten note vault powered by busytown agents.

## Quick start

1. Start the agent runner: `busytown run` (or `busytown start` for daemon mode)
2. Capture text: `/quick-capture <your text here>` Or manually:
   `busytown events push --worker user --type capture.request --payload '{"content":"your text"}'`
3. Watch the pipeline process your text into atomic notes, add backlinks, and
   generate questions.

## Pipeline

capture.request → [zettelkasten] → capture.ingested → [backlinker] →
links.updated → [breadcrumb] → breadcrumb.created → [questions] →
questions.created

## Vault structure

- Root `.md` files: Your notes (atomic ideas)
- `questions/`: Auto-generated exploratory questions
- `breadcrumbs/`: Chronological activity log (linked list of changes, trends,
  patterns)
- `idea-collider/`: Auto-generated idea collisions from random note pairs
- `agents/`: Busytown agent definitions (hidden from Obsidian)

## Commands

- `/quick-capture <text>` — Push text into the pipeline
- `/recent [N]` — Summarize recent activity from the breadcrumb trail (default:
  last 5)
- `/idea-collider` — Collide two random notes into 3 new ideas using
  oblique-strategy thinking

## Opening in Obsidian

Open this directory as an Obsidian vault. The `.obsidianignore` file hides
busytown internals.
