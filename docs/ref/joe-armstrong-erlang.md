# Joe Armstrong's Engineering Philosophy

Joe Armstrong, creator of Erlang, advocated a distinctive set of principles
shaped by building telecom systems that needed to run forever without downtime.

## Core Principles

**"Let it crash"** — Don't write defensive code trying to handle every possible
error inline. Instead, let processes fail fast and have supervisors restart them
in a known good state. The error-handling code is separated from the normal-case
code, making both simpler.

**Process isolation** — Everything runs in lightweight, isolated processes that
share nothing. No shared memory, no shared state. Processes communicate only by
sending immutable messages. This makes failures containable — one process
crashing can't corrupt another's state.

**Supervision trees** — Processes are organized hierarchically. Supervisors
watch workers and restart them according to a strategy. This gives you fault
tolerance as an architectural property rather than something you bolt on.

**"Make it work, then make it beautiful, then if you really, really have to,
make it fast."** — He was deeply skeptical of premature optimization and valued
clarity above all.

## On Software Design

**"The way to write good software is to first write bad software, then fix
it."** — He valued iteration over up-front design and was honest that you don't
understand the problem until you've tried to solve it.

**Small, understandable pieces** — He favored many small programs/processes
doing one thing well over large monolithic systems. This echoes Unix philosophy
but applied at the process level.

**Protocols over APIs** — He thought in terms of message protocols between
independent entities rather than function call interfaces. This naturally
produces loosely coupled systems.

**"Storage is the problem, not computation"** — He was wary of shared mutable
state and databases as coordination points. Immutable messages and process-local
state were preferred.

## On Complexity

**"The problem with object-oriented languages is they've got all this implicit
environment that they carry around with them."** — He was a vocal critic of OOP,
arguing that it tangles state and behavior in ways that make reasoning
difficult.

**"You wanted a banana but what you got was a gorilla holding the banana and the
entire jungle."** — His famous critique of how OOP's deep dependency graphs pull
in far more than you need.

**Avoid shared state** — Nearly every problem he diagnosed in complex systems
traced back to shared mutable state. His prescription was always: don't share,
copy, send messages.

## On Reliability

**"The phone system has to work all the time. You can't say 'we'll take it down
for maintenance on Sunday.'"** — This drove everything: hot code loading,
redundancy, the idea that the system must survive any single failure.

**Plan for failure, not perfection** — Instead of trying to prevent all failures
(impossible), design systems that recover from them gracefully. The question
isn't "how do I prevent crashes?" but "what happens after a crash?"

**Two computers minimum** — You can never build a fault-tolerant system on a
single machine. Distribution isn't optional for reliability, it's required.

## Summary

Armstrong's worldview boils down to: **isolated processes, immutable messages,
let things fail, supervise recovery, keep it simple**. He distrusted abstraction
for its own sake and valued systems you could reason about under failure
conditions — not just in the happy path.
