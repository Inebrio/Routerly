---
name: interface-contracts
description: How to freeze and arbitrate the interface between parallel implementers. Use when coordinating backend and frontend work on the same story.
---

# Interface contracts

Two implementers working at once fail in exactly one way: each assumes a
different shape at the line where their work meets. Freezing that line
before either starts is the whole job.

## What a contact point is

Anywhere data crosses between the people working in parallel: an HTTP
endpoint, a shared type, a config key, a file format, an event, an exit
code, an error string a caller matches on.

## Freezing one

A contract is frozen when both sides could implement against it without
asking a question. That means, for an endpoint:

- method and path, exactly as it will ship
- request shape, with field names and types
- response shape for success, with field names and types
- status codes, including the failure ones
- error body shape
- permission or auth required
- pagination, ordering, and what an empty result looks like

Vague is worse than wrong. `returns the list of items` is not a contract:
one side ships `{items: []}`, the other reads `[]`, and nobody finds out
until integration.

Shared types are the cheapest contract in a typed monorepo: define the type
once in the shared package, have both sides import it, and the compiler
enforces what a document cannot.

## Sequencing

Give the type or interface definition to one side as its first task and let
the other consume it. When both must start now, write the contract into the
blueprint and hold both to it verbatim.

## Arbitration

When the two sides disagree mid-flight:

1. The frozen contract wins. Neither side changes it unilaterally.
2. If the contract is genuinely wrong, decide the new shape, write it down,
   and tell both sides in the same message. Never let two versions coexist.
3. Prefer the change that keeps the consumer honest: an optional field is
   cheaper than a renamed one, a new endpoint is cheaper than a repurposed
   one.

## What is not yours to decide

- A gap in the plan goes back to whoever wrote the plan.
- A conflict with another story in flight goes up to whoever owns the
  dependency graph.
- A change to what the story asks for is not negotiable at this level.
