# Rich Hickey's Engineering Philosophy

## Core Thesis: Simple Made Easy

Hickey draws a sharp distinction between **simple** and **easy**:

- **Simple** = not complected (not intertwined). Objective property. One fold,
  one braid, one concern.
- **Easy** = near at hand, familiar. Subjective, relative to the person.

He argues the industry chronically conflates these two, reaching for
easy/familiar tools that create complexity, rather than doing the harder work of
achieving simplicity.

## Key Principles

### 1. Complecting is the root of all evil

"Complect" means to braid together. Every time you interleave two concerns, you
make the system harder to reason about, change, and debug. Good design is about
_pulling things apart_.

### 2. Values, not places

Favor immutable values over mutable state. A variable is a "place" — it changes
over time and you can't reason about it. An immutable value just _is_. This
leads to:

- Persistent data structures (structural sharing, not copying)
- Data as the primary interface, not objects
- Facts don't change — new facts can arrive

### 3. Data > Objects > Functions alone

Use plain data (maps, vectors, sets) as the primary way to represent
information. Objects complect state, identity, and behavior. Data is
transparent, serializable, generic, and can be processed by any function.

### 4. Decoupling and queues

Systems should communicate through queues and data, not direct calls. This
decouples _who_ from _when_ from _what_. He advocates for designs where
components don't know about each other.

### 5. Hammock-driven development

Step away from the keyboard. The most important phase of engineering is
_thinking about the problem_ — deeply, for hours or days. Write down the problem
statement. Sleep on it. Your background mind does real work. Most bugs come from
not understanding the problem, not from typos.

### 6. Design in the open, with words

Before code, write down: What is the problem? What do we know? What don't we
know? What are the tradeoffs? He's suspicious of diving into code as a way of
"figuring it out."

### 7. Polymorphism à la carte

Use multimethods/protocols to get polymorphism without inheritance hierarchies.
Dispatch on whatever you want, not just the first argument's type.

### 8. Epochal time model

Identity is a series of immutable states over time. A reference (atom, ref,
agent) manages the succession of values. This separates _identity_, _state_, and
_time_ — which OOP complects together.

## What He Pushes Back On

- **Type systems as design tools** — he sees most static type systems as solving
  a narrow class of problems while adding significant complection. Prefers
  runtime contracts and specs.
- **OOP** — objects complect identity, state, and behavior. Inheritance is a
  particularly bad form of complecting.
- **TDD as design methodology** — testing is good, but tests don't tell you if
  you solved the right problem or designed well. "Hammock time" does.
- **Frameworks** — they take control away from you and complect your logic with
  their lifecycle. Prefer libraries.
- **Accidental complexity disguised as best practice** — Design patterns,
  boilerplate, ceremony. If you need a pattern, your language may be missing a
  feature.

## Practical Patterns He Advocates

| Pattern                    | Instead of                |
| -------------------------- | ------------------------- |
| Plain maps/data            | Classes/objects           |
| Queues between components  | Direct function calls     |
| Immutable values           | In-place mutation         |
| Declarative specifications | Imperative validation     |
| Log of facts (append-only) | Update-in-place databases |
| REPL-driven development    | Edit-compile-run cycles   |

## Summary in His Words

> "Simplicity is a prerequisite for reliability." — Dijkstra, cited frequently
> by Hickey

> "Programmers know the benefits of everything and the tradeoffs of nothing."

The through-line: **spend more time thinking, use data not objects, don't
complect, and earn simplicity through careful design rather than reaching for
what's familiar.**
