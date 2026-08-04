---
name: story-lifecycle
description: Run one user story end to end in its own worktree, from claim to merge. Use when you are responsible for delivering a single story.
---

# Story lifecycle

One story, one worktree, one branch, one set of ports. You own it from
claim to merge. Everything you need is in the artifacts: the story file and
the blueprint. Nothing is handed to you in conversation.

## 1. Claim

```
node .claude/scripts/story.mjs claim <story-id> --feature <feature> --base <integration-branch>
```

Returns the worktree path, the branch, the assigned ports, the specs path
and the start command, and marks the story `in-progress` in the shared
registry so no other session takes it or its ports.

Then work only inside that worktree. Every command you run starts by
sourcing its environment:

```
set -a; . ./.claude-story.env; set +a
```

Skip that and you run against the developer's own state, not the story's.

## 2. Read

The story file, then the blueprint, then the code the blueprint names. In
that order. If the blueprint has a gap, it goes back to whoever wrote it:
do not fill it yourself.

## 3. Freeze the interface

Before any code, every contact point between backend and frontend work is
fixed and written down. See `interface-contracts`. Parallel work on an
unfrozen interface is the one failure mode that costs a full rewrite.

## 4. Implement

Dispatch the blueprint's tasks: backend work to the backend engineer,
interface work to the frontend engineer, in parallel when the blueprint
says they are independent, sequentially when it does not.

Both work in this worktree. Neither invents a contract. When they disagree,
you arbitrate; when the disagreement is about the plan or the story, it
goes up.

## 5. Validate

Mark the story `validating`, then hand the validator the story, the
blueprint and the diff. It runs the app on this worktree's ports and
verifies every criterion against reality. It cannot change code, by design.

- **PASS**, no blockers → continue.
- **BLOCKED** → run `remediation-loop`. Three iterations, then escalate.

## 6. Test

Only on validated code with zero blockers. The qa-engineer writes the tests:
one per acceptance criterion, one regression test per blocking finding that
was raised. It writes tests, never source.

## 7. Hand back

Report: the branch, what shipped, the validation verdict with its evidence,
the tests added, the non-blocking findings, and anything left unverified.

Integration is not yours. The session that owns the feature merges the
story branch into the integration branch, in dependency order, and only
then:

```
node .claude/scripts/story.mjs state <story-id> done
node .claude/scripts/story.mjs release <story-id>
```

`release` refuses to discard a worktree that still holds unmerged work.
That refusal is a correct answer: merge first.

## States

`planned` → `in-progress` → `validating` → `done`, with `blocked` as the
exit when the loop caps out. Move the state as it changes, not at the end:
the registry is how a parallel session knows what is happening.

## Rules

- Never touch a file outside your worktree. The specs directory is a
  symlink into the main checkout and is shared: write only your own story's
  artifacts there.
- Never take a port that is not yours. They are assigned for a reason.
- A story is done when the criteria pass with evidence, not when the code
  looks right.
