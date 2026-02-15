---
name: note
description: Capture and save notes as markdown files. Use when the user wants to take a note, jot something down, or save a thought. Triggered by /note command.
user_invocable: true
---

# Note Taking Skill

## Usage

`/note <content>` - Save a note with the given content

## Instructions

When the user invokes this skill with `/note <content>`:

1. **Parse the user's input** to extract:
   - **Tags**: Words prefixed with `#` (e.g., `#idea`, `#project`)
   - **Main content**: Everything else after removing tags
   - **Title**: Use the first sentence of the content, or infer a concise title
     from the content if no clear sentence exists

2. **Generate the filename**:
   - Convert the title to kebab-case (lowercase, spaces become hyphens, remove
     special characters)
   - Example: "My Great Idea" → `my-great-idea.md`
   - The file is saved in the current working directory

3. **Check if file exists**:
   - If the file already exists: Read it, preserve existing frontmatter metadata
     (merge tags), and update/append content as appropriate
   - If the file is new: Create it fresh

4. **Write the file** with YAML frontmatter in this format:
   ```yaml
   ---
   title: <extracted title>
   date: <current date in YYYY-MM-DD format>
   tags: [<extracted tags without # prefix>]
   ---

   <note content>
   ```

5. **Use the agent-queue skill to push a new event to the event queue**:

```bash
busytown events push --worker note --type note.created --payload '{"path":"..."}'
```

5. **Confirm to user**:
   - Tell them the filename that was created or updated
   - Show the full path
   - Mention if it was a new file or an update to an existing one

## Examples

**Input**: `/note This is my first idea #idea #brainstorm`

- Title: "This is my first idea"
- Tags: idea, brainstorm
- Filename: `this-is-my-first-idea.md`

**Input**:
`/note #meeting Discussed the roadmap for Q2. Key decisions: launch by March.`

- Title: "Discussed the roadmap for Q2"
- Tags: meeting
- Filename: `discussed-the-roadmap-for-q2.md`

## Updating Existing Notes

When a note with the same filename already exists:

- Read the existing file
- Preserve the original creation date
- Merge any new tags with existing tags (no duplicates)
- Append the new content below the existing content with a blank line separator
- Add a timestamp comment for the update: `<!-- Updated: YYYY-MM-DD -->`
