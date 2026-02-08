## Synthesis of Patterns

### Summaries

**Actor Model** — A concurrency paradigm where isolated entities (actors)
communicate exclusively through asynchronous messages. Each actor has private
state and a mailbox, processing messages one at a time. This eliminates data
races without locks. Actors can update their state, send messages to other
actors, and spawn new actors. Formalized by Carl Hewitt in 1973; foundational to
Erlang/OTP and Akka.

**Event-Driven Architecture (EDA)** — A system design where components
communicate through events routed by a shared intermediary (bus/broker).
Producers emit events without knowing who consumes them; consumers subscribe and
react independently. Two main variants: pub/sub (broadcast) and event queue
(pull-based with delivery guarantees). The bus decouples producers from
consumers in space, time, and identity.

**Event Sourcing** — A persistence pattern where state is stored as an
append-only log of immutable events rather than being updated in place. Current
state is derived by replaying the log. Commands are validated against replayed
state, and new events are appended. Pairs naturally with CQRS, where writes
target the event log and reads come from optimized projections.

**Reducer** — A pure function `(state, action) → state` that expresses state
transitions as a left fold over a stream of actions. Grounded in Hutton's proof
that `fold` is a universal operator for sequential computation. Deterministic,
testable, and composable — the action log doubles as a complete history enabling
replay and time-travel debugging.

---

### Comparisons

**What they share.** All four patterns reject shared mutable state in favor of
messages/events/actions flowing through the system. All naturally produce a log
of what happened, enabling auditability and replay. All achieve concurrency
safety not through locks, but through sequential processing of ordered inputs —
whether that's an actor's mailbox, an event queue, or a reducer folding over
actions.

**Scope and concern.** They operate at different levels of abstraction:

| Pattern        | Primary concern                          | Scope                          |
| -------------- | ---------------------------------------- | ------------------------------ |
| Reducer        | How state evolves                        | A single function              |
| Actor Model    | How concurrent entities communicate      | A runtime/process model        |
| Event Sourcing | How state is persisted                   | A storage/persistence strategy |
| EDA            | How system components are wired together | A system architecture          |

A reducer is the smallest unit — a pure function with no opinion about
concurrency, persistence, or communication. An actor wraps a reducer-like loop
inside a concurrent process with a mailbox. Event sourcing decides that the
action stream feeding a reducer should be persisted as the source of truth. EDA
zooms out further to describe how many independent components exchange events
across a whole system.

**Composability.** These patterns nest naturally. An actor's message-processing
loop is effectively a reducer over its mailbox. Event sourcing provides the
durable log that makes a reducer's action stream persistent and replayable. EDA
is the connective tissue that routes events between actors, event-sourced
aggregates, or any other component. You can build a system that uses all four
simultaneously without contradiction.

**Coupling and topology.** The actor model uses point-to-point addressing (send
to an actor by address). EDA uses a broker to fully decouple sender and receiver
— producers don't even know receivers exist. Event sourcing is agnostic to
topology; it cares about the log, not who reads it. The reducer is topology-free
— it's just a function.

**State visibility.** Actors hide state behind a message boundary — you can only
interact with an actor's state by sending it a message. Reducers make state
transitions fully transparent and inspectable (pure function, no encapsulation).
Event sourcing makes the full history of state transparent through the event
log. EDA doesn't prescribe how individual components manage state at all.

**Determinism.** The reducer is the most deterministic: same inputs always
produce the same output. Actors introduce nondeterminism through message
ordering across actors (within a single actor, processing is deterministic). EDA
amplifies this — events may arrive out of order, be duplicated, or be processed
by parallel consumers. Event sourcing restores determinism for a single
aggregate by providing a canonical, ordered event stream.

**Where they diverge most.** The reducer and event sourcing are fundamentally
about _state_ — how it evolves and how it's stored. The actor model and EDA are
fundamentally about _communication_ — how components interact. This is why they
compose so well: one pair answers "what happens to data" and the other answers
"how data moves."
