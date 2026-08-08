---
name: blueprint-format
description: Shape of a story blueprint, the technical plan an orchestrator executes. Use when writing or reading a blueprint artifact.
---

# Blueprint format

One file per story: `<specs-root>/<feature>/02-blueprint/<story-id>.md`.

```markdown
# <story-id> — Blueprint

## Approach
The chosen shape in one paragraph, and the alternative you rejected with the
reason. No restatement of the why: that is closed in the analysis.

## Data model
What is stored, in what shape, what changes, what migrates. "Nothing" is a
valid and welcome answer.

## Files
| Path | New or changed | Responsibility |

## Contact points
Every interface between backend and frontend work, frozen:

| Contract | Shape | Consumed by |
Endpoint, method, request payload, response payload, status codes, error
shape, permission required. Field names exactly as they will ship.

## Tasks
| # | Task | Surface | Depends on | Done when |
One row is one engineer dispatch. Independently verifiable, but not
necessarily one file or one step: group mechanical, same-surface steps with
no cross-cutting contract (a config edit, a single-file addition, a small
parity check) into one row rather than splitting by step. "Done when" ties
back to the story's acceptance criteria by id, and may list several ids when
a row bundles several steps.

## Validation setup
- Start command: the exact command, run from the worktree root.
- Environment: what to source, which ports, which isolated runtime.
- Credentials and seed data the validator needs.
- How to reach each surface the story touches.

## Risks
What this plan could get wrong, and the cheapest way to find out early.
```

## Rules

- Written against the code you actually read, never against how projects
  usually look.
- Every contact point is frozen here or the orchestrator will have to
  invent it. Ambiguity at this line is the most expensive kind.
- The start command is executed verbatim by the validator. A wrong one
  invalidates the whole validation, so verify it before writing it down.
- Plan the smallest thing that satisfies the story. No extension points
  nobody asked for, no abstraction with a single implementation.
- If the story cannot be built as written, state the conflict at the top
  with options and consequences, then plan what can be built.
