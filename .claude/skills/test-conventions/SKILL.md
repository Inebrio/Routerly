---
name: test-conventions
description: Where tests live in this repository, how to run them, and what a story owes in coverage. Use when writing or running tests.
---

# Test conventions

## Layout

- Unit and integration tests: `*.test.ts`, beside the source they cover.
- Runner: vitest, through the workspace scripts.

```
npm test                                  # everything
npm test --workspace=packages/service     # one package
```

## What a story owes

- One test per acceptance criterion, named so the criterion id is
  recognisable in the output.
- One regression test per blocking finding the validator raised. That
  finding got through once; the test is what stops it coming back.
- Edge cases from the story: absent, empty, malformed, unauthorised,
  duplicate.
- Every management endpoint: `fastify.inject()` proving allowed → 200 and
  forbidden → 403.

## How to write them

- Assert on observable behaviour: the response, the exit code, the stored
  state, what the page shows. Never on internal call order.
- One reason to fail per test. A test asserting five unrelated things tells
  you nothing when it goes red.
- No sleeps. Wait for the condition.
- Deterministic: no dependency on wall-clock time, on ordering between
  tests, or on state another test left behind.
- Never weaken an assertion to make a test pass. A failing test is either a
  bug in the code or a wrong test, and both need saying out loud.
- Never touch the developer's own runtime state. Tests run against the
  story's isolated environment.

## Browser coverage

Anything a user sees gets exercised in a real browser: the happy path, one
failure path, both themes. A console error is a failure even when the
screen looks right.

## Boundary

You write tests, not source. If a test cannot pass without changing source,
that is a finding to report, not a change to make.
