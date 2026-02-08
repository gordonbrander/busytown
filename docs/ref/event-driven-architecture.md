# Event-Driven Architectures

## What They Are

An event-driven architecture (EDA) is a software design pattern where the flow
of the program is determined by **events** — significant changes in state —
rather than by sequential procedure calls. Components communicate by producing
and consuming events through a shared intermediary (the "event bus" or "message
broker"), rather than calling each other directly.

## How They Work

The core components:

- **Producers** — emit events when something happens (e.g., "order placed",
  "user signed up")
- **Event Bus / Broker** — receives events and routes them to interested parties
  (e.g., Kafka, RabbitMQ, Redis Streams, or even an in-process channel)
- **Consumers** — subscribe to event types and react when they arrive

The flow:

```
Producer → Event Bus → Consumer A
                    → Consumer B
                    → Consumer C
```

Producers don't know (or care) who consumes their events. Consumers don't know
who produced them. The bus decouples the two sides.

**Two common patterns:**

1. **Pub/Sub** — consumers subscribe to event types. The bus broadcasts to all
   subscribers.
2. **Event Queue** — events sit in a queue and are pulled by workers, typically
   with at-least-once delivery guarantees and acknowledgment.

## Advantages

**Loose coupling** — Producers and consumers are independent. You can add,
remove, or modify consumers without touching producers.

**Scalability** — Consumers can be scaled independently. If order processing is
slow, add more order-processing workers without touching anything else.

**Resilience** — If a consumer goes down, events queue up and get processed when
it recovers. The system degrades gracefully rather than failing entirely.

**Extensibility** — Adding new behavior means adding a new consumer. "Also send
a welcome email on signup" is a new subscriber, not a modification to the signup
code.

**Temporal decoupling** — Producers and consumers don't need to be running at
the same time. The bus acts as a buffer.

**Auditability** — If you persist events, you have a complete log of everything
that happened, in order. This enables event sourcing, replay, and debugging.

## Unique Challenges

**Eventual consistency** — Since events are processed asynchronously, different
parts of the system may be temporarily out of sync. You can't assume a consumer
has processed an event just because it was emitted. This is a fundamental shift
from request/response models.

**Ordering guarantees** — Events may arrive out of order, or be processed out of
order by parallel consumers. Systems that depend on ordering need partitioning
strategies (e.g., Kafka partitions by key).

**Debugging complexity** — There's no call stack to follow. A bug might involve
a chain of events across multiple services. Distributed tracing (correlation IDs
propagated through events) becomes essential.

**Idempotency** — Most brokers guarantee at-least-once delivery, meaning
consumers may see the same event twice. Every consumer must handle duplicates
safely — processing the same event twice should produce the same result as
processing it once.

**Error handling** — What happens when a consumer fails to process an event? You
need dead-letter queues, retry policies, and alerting. A poisoned event can
block an entire queue if not handled.

**Schema evolution** — Events are contracts. When a producer changes the shape
of an event, all consumers must handle both old and new formats, or you need a
versioning/migration strategy.

**Backpressure** — If producers emit events faster than consumers can process
them, queues grow unboundedly. You need monitoring, flow control, or consumer
auto-scaling.

**Testing** — End-to-end testing is harder because behavior emerges from the
interaction of independent components reacting to events asynchronously.
Integration tests need to account for timing and eventual consistency.

## When to Use It

EDA shines when you have multiple independent reactions to the same trigger,
need to scale components independently, or want to decouple teams/services. It's
overkill for simple CRUD apps where a direct function call would suffice. The
complexity tax is real — adopt it when the benefits clearly outweigh the
operational overhead.
