## The Actor Model

The actor model is a concurrency paradigm where **actors** are the fundamental
unit of computation. Each actor is an isolated entity that:

1. **Has private state** — no shared memory with other actors
2. **Has a mailbox** — an ordered queue of incoming messages
3. **Processes messages one at a time** — sequential processing within each
   actor, concurrency across actors

## Message Processing

An actor's lifecycle is essentially an infinite loop:

1. **Wait** for a message to arrive in the mailbox
2. **Dequeue** the next message (FIFO)
3. **Process** it — and in response, the actor may:
   - Update its own internal state
   - Send messages to other actors (by address)
   - Create new actors
4. **Repeat**

The critical constraint: an actor processes **exactly one message at a time**.
It finishes handling the current message before picking up the next one. This
eliminates data races within an actor without locks or synchronization.

## Key Properties

- **Location transparency** — you send messages to an address, not a direct
  reference. The actor could be local or remote.
- **Asynchronous messaging** — sends are fire-and-forget. The sender doesn't
  block waiting for the receiver to process the message.
- **Fault isolation** — if an actor crashes, it doesn't corrupt other actors'
  state. Supervisors can restart failed actors.
- **Backpressure** — messages queue in the mailbox. If an actor can't keep up,
  its mailbox grows, which can be monitored.

## Example Flow

```
Actor A                    Actor B
  |                          |
  |--- msg("hello") ------->|  (enqueued in B's mailbox)
  |--- msg("world") ------->|  (enqueued behind "hello")
  |                          |
  |  (A continues working)   |-- processes "hello"
  |                          |-- updates internal state
  |                          |-- sends reply to A
  |                          |-- processes "world"
  |<-- msg("ack") ----------|
```

The model was formalized by Carl Hewitt in 1973 and is the foundation of
Erlang/OTP, Akka, and Orleans, among others.
