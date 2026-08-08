---
name: validation-protocol
description: How to validate a story against its criteria and write the report, including what counts as evidence and what counts as blocking. Use when verifying implemented work.
---

# Validation protocol

One file per story: `<specs-root>/<feature>/03-validation/<story-id>.md`.

## Two levels, in this order

**Static.** Read the story, the blueprint, and the diff. For each acceptance
criterion and each edge case, find the code that satisfies it. A criterion
with no code behind it is failed before anything runs.

**Dynamic.** Start the application with the exact command in the blueprint,
in the story's own worktree, with its own environment sourced and its own
ports. Then exercise every criterion the way a user would: browser for
anything a user sees, real commands for the command line, real HTTP for the
API. Reading the code is never a substitute for running it.

## Evidence

A verdict without evidence is an opinion. Every criterion carries what you
actually observed:

- the command you ran and its output, or
- the request you sent and the response you got, or
- the browser steps you took and what the page showed.

Also check what nobody asked you to: the console for errors, the server log
for stack traces, the other theme, the empty state, a second run of the same
action.

## Classification

**Blocking** — a criterion or edge case fails, the app does not start, data
is lost or corrupted, a security or permission check is missing or wrong, a
surface the story requires is absent, or the change breaks something that
worked before.

**Non-blocking** — everything else: cosmetics, wording, a slow path, a
refactor you would have done differently. Record it, do not gate on it.

## Report

```markdown
# <story-id> — Validation

## Verdict
PASS or BLOCKED. One line of why.

## Criteria
| Id | Result | Evidence |
Every AC and EC from the story, none skipped, none invented.

## Blocking findings
### B1 — <what is wrong>
- Expected: <from the story, quoted>
- Observed: <what happened>
- Evidence: <command, output, or steps>
- Location: <file:line, when known>

## Non-blocking findings
One line each.

## Not verified
What you could not check and why. Never leave this implicit.
```

## Boundaries

You can run anything. You cannot change anything except this report. Do not
route a fix through another tool, and never ask another agent to apply one
for you: your value is that you did not write the code. A finding you fix
is a finding nobody reviews.
