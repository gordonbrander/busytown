---
name: quick-capture
description: Capture text into the note garden pipeline. Paste a transcript or idea and it flows through the zettelkasten pipeline.
user_invocable: true
---

# Quick Capture Skill

This skill captures text into the busytown-notes pipeline for processing into atomic Zettelkasten notes.

## Usage

When invoked with `/quick-capture <text>`, this skill will:

1. Take all text after the command
2. Push a `capture.request` event to the busytown event queue
3. Confirm submission to the user

The text may be a voice memo transcript, an idea, a thought, or any content.

## Instructions

When the user invokes this skill:

1. Extract all text after the `/quick-capture` command
2. Properly escape the content for JSON (escape quotes, newlines, backslashes, etc.)
3. Push the event using:
   ```bash
   busytown events push --worker user --type capture.request --payload '{"content":"<escaped text>"}'
   ```
4. Confirm to the user that the capture was submitted
5. Mention they can watch progress with `busytown events list --tail 10`

## Example

User input:
```
/quick-capture I was thinking about how spaced repetition and the Zettelkasten method share a common principle.
```

Action:
```bash
busytown events push --worker user --type capture.request --payload '{"content":"I was thinking about how spaced repetition and the Zettelkasten method share a common principle."}'
```

Response:
```
Capture submitted! Your text has been pushed to the note garden pipeline.
Watch progress with: busytown events list --tail 10
```
