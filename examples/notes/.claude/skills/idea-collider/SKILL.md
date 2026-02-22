---
name: idea-collider
description: Collide two random notes into new ideas using oblique-strategy thinking. Generates 3 new ideas in the idea-collider/ folder.
user_invocable: true
---

# Idea Collider Skill

This skill triggers the idea collider agent, which picks two random notes from
the vault and smashes them together to generate 3 new ideas.

## Usage

When invoked with `/idea-collider`, this skill will:

1. Push a `collider.request` event to the busytown event queue
2. The idea-collider agent will pick 2 random notes, apply oblique-strategy
   thinking, and create 3 new idea notes in `idea-collider/`
3. Confirm submission to the user

## Instructions

When the user invokes this skill:

1. Push the event using:
   ```bash
   busytown events push --worker user --type collider.request --payload '{}'
   ```
2. Confirm to the user that the collision was triggered
3. Mention they can watch progress with `busytown events list --tail 10`

## Example

User input:

```
/idea-collider
```

Action:

```bash
busytown events push --worker user --type collider.request --payload '{}'
```

Response:

```
Idea collision triggered! The idea-collider agent will pick two random notes and generate 3 new ideas.
Watch progress with: busytown events list --tail 10
```
