---
name: project-conventions
description: Non-negotiable rules of this project — wire transparency, surface parity, permission chain, branch policy. Use when planning or reviewing any change here.
---

# Project conventions

## Wire-format transparency (absolute)

This product is a router. It forwards requests to a provider and returns the
response unaltered.

- No custom headers on request or response. None added, removed or renamed.
- No non-standard payload fields. What the SDK sent is what the provider
  gets; what the provider returned is what the client gets.
- Drop-in: a client using the official SDK works by changing only the base
  URL. No client-side change is ever acceptable.
- Payload changes only for explicitly requested features (guardrails, PII
  scrub, cache), and only the minimum needed.
- Never take a wire-format detail from memory. Read the live provider spec
  and cite the URL.
- Never modify, block or rewrite a user request without explicit
  authorisation. There is no safe-by-default category.

## Surface parity

A service change is a CLI change and a dashboard change. The three ship
together. The only exception is a surface with no possible entry point for
the feature, and it must be stated explicitly with the reason.

## New permission

Follow the chain end to end, or the permission exists but protects nothing:

1. `Permission` union in `packages/shared/src/types/config.ts`
2. `ALL_PERMISSIONS` in `packages/service/src/routes/api.ts`
3. `packages/dashboard/src/api.ts`
4. `packages/dashboard/src/pages/RolesPage.tsx`
5. Enforce it on the route, and test both sides: allowed → 200,
   forbidden → 403.

## Branching

Work branches from the current integration branch and merges back into it.
Never from or into the default branch: it is far behind.

## Scope

Solve the current problem only. Simplest correct diff. Touch only what the
task requires. No speculative abstraction, no extension point nobody asked
for.

## Quality bar

Visual quality and usability rank with functional correctness. Something
that works but looks broken or is hard to use is not done.

## Writing

Artifacts, code, comments, commits and UI text in English. No em dashes
anywhere. Never write temporary or scratch files inside the project
directory: use `/tmp` or the session scratchpad. Screenshots belong in the
docs tree only when they are permanent documentation.
