---
name: analysis-format
description: Shape of a feature analysis document (00-analysis.md). Use when writing or reading the analysis artifact that opens a feature.
---

# Analysis format

One file per feature: `<specs-root>/<feature>/00-analysis.md`.

```markdown
# <feature> — Analysis

## Request
What was asked, in one paragraph, rewritten so it survives without the
original conversation.

## Problem
What breaks today, for whom, and how you know. Evidence, not assumption.

## Out of scope
What a reader could reasonably think is included and is not.

## Findings
What the codebase already does here. One bullet per fact, each with the
file and line that proves it.

## Constraints
Architectural invariants this feature must not break, and why they exist.
External specs it must obey, with the URL you actually read.

## Options considered
| Option | Fits the architecture | Cost | Verdict |
Only for decisions with real alternatives. One line of reasoning each.

## Tasks
Numbered, atomic, independently implementable and verifiable.

| # | Task | Surface | Depends on |

## Dependency graph
Which tasks run in parallel and which cannot. State the reason for every
serialisation: shared files, shared contract, shared migration.

## Assumptions
Every decision you made instead of asking. A reader must be able to
overturn one and know exactly what changes.

## Open risks
What could still be wrong, and what would reveal it.
```

## Rules

- Every factual claim about the codebase carries a file reference.
- Every claim about an external system carries the URL you read, not memory.
- A task nobody can verify from outside the code is not a task, it is a
  wish. Split it or drop it.
- The dependency graph is the contract for parallelism. Getting it wrong
  costs a merge conflict at integration, so be conservative: when two tasks
  might touch the same file, serialise them.
