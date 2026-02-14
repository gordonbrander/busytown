---
name: recent
description: Summarize recent activity in the note garden by reading breadcrumbs
user_invocable: true
---

# Recent Activity Skill

This skill summarizes recent activity in the note garden by reading the breadcrumb trail and producing an on-demand rollup.

## Usage

When invoked with `/recent` (optionally with a number like `/recent 5`), this skill provides a summary of what's been happening in the vault recently.

## Instructions

When the user invokes this skill:

1. **Parse the command**: Extract the optional number parameter (default to 5 if not provided)
   - `/recent` → look at 5 most recent breadcrumbs
   - `/recent 10` → look at 10 most recent breadcrumbs

2. **Find recent breadcrumbs**: Use Glob to find all files in `breadcrumbs/*.md`. Sort by filename (they're chronologically named with timestamps). Take the most recent N entries.

3. **Read the breadcrumbs**: Read each breadcrumb file, following the linked list via the `previous` frontmatter field if needed for additional context.

4. **Read referenced notes**: For each breadcrumb, read the notes listed in the `notes_touched` frontmatter array to understand what was actually captured or modified.

5. **Produce a rollup summary** that includes:
   - **Timeline**: What happened and when (from most recent backwards). Show the timestamp from each breadcrumb filename and its summary.
   - **Key topics**: What subjects have been captured recently. Extract key concepts from the breadcrumbs and notes.
   - **Emerging patterns**: Trends across multiple breadcrumbs (recurring themes, growing topic clusters, connections between notes).
   - **Active threads**: Open questions and dangling ideas from the breadcrumbs (check the `open_questions` field if present).
   - **Vault stats**: Quick count of:
     - Total notes in the vault (`.md` files in root, excluding hidden/internal directories)
     - Total questions (files in `questions/`)
     - Total breadcrumbs (files in `breadcrumbs/`)

6. **Present the summary**: Output a nicely formatted text response to the user. DO NOT write this to a file—just return it as conversational output.

## Important Notes

- This is a read-only skill: DO NOT push any events or write any files
- Focus on the breadcrumb trail as the primary source of truth for "what happened"
- Use actual note content to enrich the summary with real context
- If there are fewer breadcrumbs than requested, just use what's available
- Present information in reverse chronological order (most recent first)

## Example

User input:
```
/recent 3
```

Expected behavior:
1. Find the 3 most recent `breadcrumbs/*.md` files
2. Read each breadcrumb and its referenced notes
3. Generate a summary showing:
   - Timeline of the last 3 captures/operations
   - Topics covered
   - Any patterns or connections
   - Vault statistics

Response format (example):
```
# Recent Activity in Note Garden

## Timeline (Last 3 Breadcrumbs)

**2026-02-13 14:32** - Captured ideas about spaced repetition
- Added note: [[spaced-repetition-principles.md]]
- Connected to existing note on Zettelkasten method

**2026-02-13 10:15** - Processed transcript about learning systems
- Created 3 atomic notes
- Generated 2 exploratory questions

**2026-02-12 16:48** - Captured thought on emergence
- Added note: [[emergence-in-complex-systems.md]]

## Key Topics
- Learning systems and memory
- Complex systems
- Knowledge management

## Emerging Patterns
- Growing cluster around cognitive science topics
- Multiple notes now connecting to Zettelkasten methodology

## Active Threads
- Open question: How does spaced repetition relate to network effects?
- Follow-up needed: Explore connection between emergence and learning

## Vault Stats
- 47 notes
- 12 questions
- 8 breadcrumbs
```
