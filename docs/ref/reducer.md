# The Reducer Pattern

The reducer pattern expresses state evolution as a pure function:

```
(state, action) → state
```

Given the current state and an action describing what happened, produce the next
state. That's the entire pattern.

## Connection to Fold (Hutton, 1999)

Hutton's paper "A tutorial on the universality and expressiveness of fold"
demonstrates that `fold` (a.k.a. `reduce`) is a **universal** operator — any
function over a list that follows a simple recursive pattern can be expressed as
a fold. The signature of a left fold is:

```
foldl :: (b → a → b) → b → [a] → b
```

Map the types directly:

| Fold component | Reducer concept             |
| -------------- | --------------------------- |
| `b`            | State type                  |
| `a`            | Action type                 |
| `b → a → b`    | The reducer function        |
| initial `b`    | Initial state               |
| `[a]`          | Stream of actions over time |

A reducer **is** a fold over a stream of actions:

```js
finalState = actions.reduce(reducer, initialState);
```

Hutton's key results — that fold is both **universal** (many recursive functions
can be rewritten as folds) and **expressive** (fold can encode surprisingly
complex computations) — transfer directly. The reducer pattern isn't just one
way to manage state; it's a _maximally general_ way to express sequential state
transitions.

## Benefits

1. **Determinism** — same state + same action = same result, always. No hidden
   inputs.
2. **Testability** — pure functions with no side effects are trivially
   unit-testable.
3. **Replay / time-travel** — the action log is a complete history. Fold over it
   to reconstruct any past state, or replay from a snapshot.
4. **Separation of concerns** — _what happened_ (action) is decoupled from _how
   state changes_ (reducer). Producers of events don't need to know about state
   shape.
5. **Composability** — reducers compose: you can split a large reducer into
   smaller ones over sub-states and combine them.
6. **Event sourcing** — the action stream is a first-class audit trail. State
   becomes a derived, materialized view.
7. **Concurrency-friendliness** — because state transitions are sequential
   folds, concurrent systems can serialize actions through a queue and guarantee
   consistent state without locks on the state itself.

The deep insight from Hutton is that this isn't an arbitrary architectural
choice — it's a _mathematically universal_ pattern for computing over sequences.
Any sequential state machine you can write recursively, you can write as a
reducer.
