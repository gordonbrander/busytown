# Event Sourcing

Event sourcing is an architectural pattern where **state changes are stored as
an immutable sequence of events** rather than storing just the current state.

## Core Idea

Instead of updating a record in place (e.g., `balance = 150`), you append events
that describe what happened:

```
1. AccountOpened  { id: "A1", owner: "Alice" }
2. MoneyDeposited { id: "A1", amount: 200 }
3. MoneyWithdrawn { id: "A1", amount: 50 }
```

The current state (`balance = 150`) is derived by **replaying** these events in
order.

## How It Processes Messages

1. **Command arrives** — a request to do something (e.g., "withdraw $50")
2. **Validate** — load current state by replaying past events, check business
   rules (sufficient funds?)
3. **Emit event** — if valid, append an immutable event to the log (e.g.,
   `MoneyWithdrawn`)
4. **Update projections** — consumers/read models process the new event to
   update derived views (query-optimized tables, caches, etc.)

## Key Properties

- **Append-only** — events are never modified or deleted, giving a full audit
  trail
- **Replayable** — you can rebuild state from scratch by replaying the event log
- **Temporal queries** — you can answer "what was the state at time T?" by
  replaying up to that point
- **Decoupled consumers** — multiple independent readers can process the same
  event stream for different purposes (projections, notifications, analytics)

## Trade-offs

| Benefit                             | Cost                                     |
| ----------------------------------- | ---------------------------------------- |
| Complete audit history              | Storage grows over time                  |
| Easy debugging (replay)             | Eventual consistency in read models      |
| Flexible projections                | Schema evolution of events requires care |
| Natural fit for distributed systems | More conceptual complexity than CRUD     |

## Contrast with Traditional CRUD

```
CRUD:    UPDATE accounts SET balance = 150 WHERE id = 'A1'
         (previous state is lost)

Event Sourced:  events = [Opened, Deposited(200), Withdrawn(50)]
                state  = replay(events) → { balance: 150 }
                (full history preserved)
```

Event sourcing pairs naturally with **CQRS** (Command Query Responsibility
Segregation), where writes go to the event log and reads come from optimized
projections built from those events.
