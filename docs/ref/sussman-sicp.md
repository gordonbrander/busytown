# Gerald Jay Sussman's Engineering Philosophy

## Core Concern: Why Is Software So Brittle?

Sussman's central preoccupation — especially in his later career — is that
software systems are far too fragile compared to biological systems. A small
change in requirements often demands a disproportionate rewrite. His work asks:
**how do we build systems that are flexible, evolvable, and robust in the way
that organisms are?**

## Key Principles

### 1. Composability from Simple Parts

From SICP onward, Sussman advocates building complex behavior by combining
small, well-understood pieces. The system's power comes from **combination**,
not from the complexity of individual components.

### 2. Additive Programming

One of his strongest convictions: **you should be able to extend a system by
adding new code, not modifying existing code.** New capabilities should layer on
without disturbing what already works. This is the central theme of _Software
Design for Flexibility_ (2021, with Chris Hanson).

### 3. Generic Dispatch

Build operations that work across multiple representations. Rather than
hardcoding behavior for specific types, use **generic procedures** that dispatch
based on the nature of their arguments. This lets you add new representations
later without touching existing code.

### 4. Combinators

Use **function combinators** (compose, spread, parallel-combine) to build new
functions from existing ones. This is a disciplined alternative to ad-hoc glue
code — it gives you a vocabulary for wiring behavior together.

### 5. Propagator Networks

Sussman's propagator model (with Radul) replaces the traditional "one-way
function call" with a network of autonomous cells connected by propagators.
Information flows in multiple directions, partial information is welcome, and
**you never retract — you only add.** This naturally supports constraint
propagation, provenance tracking, and incremental computation.

### 6. Layered Data

Attach metadata — provenance, units, confidence, dependencies — directly to
values. This lets you track _where_ information came from and _why_ you believe
it, which is essential for debugging and for systems that reason about their own
knowledge.

### 7. Degeneracy (from Biology)

Biological systems are robust because they have **multiple different
mechanisms** that can achieve the same function. Sussman argues software should
have this property too — redundant, overlapping pathways that provide resilience
rather than the single-path-of-execution brittleness we typically build.

### 8. Abstraction Barriers

Create clean interfaces between layers. Each layer should be understandable and
modifiable independently. But critically, don't over-abstract — the abstraction
should serve flexibility, not bureaucracy.

### 9. Domain-Specific Languages

When a problem domain has its own natural vocabulary, **build a language for
it** rather than forcing the domain into a general-purpose framework. SICP's
metacircular evaluator and the numerical methods DSL in _Structure and
Interpretation of Classical Mechanics_ both demonstrate this.

## The Biological Metaphor

Sussman frequently contrasts engineered systems with biological ones:

| Engineering (typical)      | Biology (aspiration)    |
| -------------------------- | ----------------------- |
| Tight specification        | Loose, tolerant         |
| Single path                | Degenerate (many paths) |
| Breaks on unexpected input | Degrades gracefully     |
| Modify to extend           | Add to extend           |
| Centralized control        | Decentralized, emergent |

## Signature Quote

> "Programs must be written for people to read, and only incidentally for
> machines to execute." — SICP

## In Practice

The throughline across decades of Sussman's work is: **build systems that
tolerate the unexpected.** Use generic dispatch so new types slot in. Use
combinators so new behaviors compose cleanly. Use additive design so extensions
don't break invariants. Use propagators so information flows without rigid
directionality. The result should be software that, like a biological organism,
can adapt to changes its original designer never anticipated.
