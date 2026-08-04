---
name: user-story-format
description: Shape of a user story file with acceptance criteria and edge cases. Use when writing or reading a story artifact.
---

# User story format

One file per story: `<specs-root>/<feature>/01-stories/<story-id>.md`.

```markdown
# <story-id> — <short title>

## Story
As <who>, I want <what>, so that <why>.

## Context
The two or three sentences from the analysis a reader needs. No more.

## Acceptance criteria
- **AC1** — Given <state>, when <action>, then <observable result>.
- **AC2** — ...

## Edge cases
- **EC1** — <condition> → <required behaviour>.

## Out of scope
What this story deliberately does not cover.

## Depends on
Story ids that must land first, and why.
```

## Rules

- Criteria are observable from outside the code. If checking one requires
  reading the implementation, rewrite it.
- Criteria are independent: the result of one never depends on which other
  criterion ran first.
- No file names, function names, endpoints, tables or components. A story
  that cannot be written without them is a design document.
- Edge cases are the ones this story can actually hit. Cover absent, empty,
  malformed, unauthorised, duplicate, concurrent and oversized inputs where
  they apply, and say what should happen, not that it "should fail".
- Numbered ids matter: the validator reports against them and the
  qa-engineer maps tests to them.
- One story is one deliverable. If it needs two independent verdicts, it is
  two stories.
