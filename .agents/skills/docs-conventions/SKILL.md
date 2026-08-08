---
name: docs-conventions
description: Where documentation lives in this repository, how a page is structured, and what a change owes the docs. Use when writing or updating documentation.
---

# Documentation conventions

Content is markdown under `docs/`. The site that renders it is Docusaurus in
`website/`, with the navigation in `website/sidebars.ts`.

| Directory | Covers |
|---|---|
| `docs/getting-started/` | Install and first run |
| `docs/concepts/` | How the product thinks: routing, experiments, profiles |
| `docs/service/` | Running and configuring the service |
| `docs/api/` | The proxy endpoints and the management API |
| `docs/cli/` | Every command and flag |
| `docs/dashboard/` | Every page, one file per page |
| `docs/guides/`, `docs/integrations/`, `docs/examples/` | Task and client oriented walkthroughs |
| `docs/reference/` | Tables a reader looks things up in |
| `docs/assets/` | Images. The only place a screenshot may live |

## Page shape

Every page opens with frontmatter:

```markdown
---
title: Commands
sidebar_position: 2
---
```

A new page is added to `website/sidebars.ts`, or nobody will find it.
Position it where a reader would expect it, not at the end.

## What a change owes

A feature is documented on every surface it ships on. Service change means
the API page, the CLI page and the dashboard page, all three, or the
documentation now describes a product that does not exist.

For each surface:
- **API**: method, path, request and response bodies with real field names,
  status codes, the permission required, and one runnable example.
- **CLI**: the command with its real flags, one example invocation, the
  output the user will actually see, and the exit codes.
- **Dashboard**: where the thing is, what it does, what the states mean.

## How to write it

- Verify against the code, never against the story or the blueprint. Those
  say what was intended; the code is what shipped.
- Every command and payload in a page must be copy-pasteable and correct.
  Run it before you write it down.
- Document what exists now. No "coming soon", no future tense, no
  placeholder page.
- Update the pages a change invalidates. A stale page is worse than a
  missing one: it is believed.
- Same voice as the pages around it. Short sentences, second person,
  present tense. English, no em dashes.
- Screenshots only when the words cannot do it. They go in `docs/assets/`
  and nowhere else, and they are regenerated when the interface changes.
