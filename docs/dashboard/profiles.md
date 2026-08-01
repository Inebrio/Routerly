---
title: Profiles
sidebar_position: 11
---

# Dashboard: Profiles

The Profiles page manages reusable configurations that any number of projects
can adopt. A profile comes in one of three kinds:

| Kind | What it bundles |
|------|-----------------|
| **Routing** | policy list, selector, fallback strategy |
| **Optimizer** | the ordered list of optimizer steps and which of them are enabled |
| **Security** | content guardrail rules and PII redaction policies |

A project can be assigned one profile per kind, independently: routing from a
profile, security custom, optimizer from another profile. See
[Projects](./projects.md#routing-tab) for the assignment controls.

Navigate to `/dashboard/profiles`.

![Profiles list showing routing, optimizer and security profiles with the kind filter](../assets/screenshot-profiles.png)

See [Concepts: Routing](../concepts/routing.md) for each routing policy's
behaviour and parameters.

---

## Profiles List

| Column | Description |
|--------|-------------|
| **Label** | Display name of the profile |
| **Kind** | `Routing`, `Optimizer` or `Security` |
| **Type** | `Built-in` (read-only) or `Custom` (user-created, editable) |
| **Configuration** | One-line summary of what the profile configures |
| **Version** | Increments by 1 on every edit |

The **Kind** dropdown filters the list; `All kinds` shows everything. The
counter on the left reflects the filtered list.

Routerly ships these built-in profiles:

- Routing: **Auto**, **Cheap**, **Fast**, **Coding**
- Optimizer: **Safe**, **Balanced**, **Aggressive**
- Security: **Standard**, **Strict**

Built-in profiles cannot be edited or deleted, so their row shows a **View**
(read-only) button instead of Edit. Custom profile rows show **Edit** and
**Delete** with `profiles:manage`. Every row has a **Clone** button with
`profiles:manage`.

Without `profiles:read`, the page shows a permission-denied empty state.
Without `profiles:manage`, every row is view-only and **New Profile** is hidden.

---

## Creating a Profile

Click **New Profile** to open the form at `/dashboard/profiles/new`.

1. Enter a **Label**
2. Pick a **Kind**. Switching kind swaps the configuration editor below and
   resets it to that kind's empty configuration
3. Fill in the configuration (see the per-kind editors below)
4. Click **Create Profile**

The kind cannot be changed after creation: the stored configuration shape
depends on it. To change kind, create a new profile.

### Cloning

The **Clone** button on a list row opens the same form pre-filled with that
profile's configuration and a `<label> copy` label, with the kind locked to
the source profile's kind. Nothing is written until **Create Profile** is
clicked, so a clone can be adjusted before it exists.

---

## Editing a Profile

Click **Edit** on a custom profile row to open `/dashboard/profiles/<id>`.
**Save Profile** persists the change and bumps `version` by 1; **Cancel**
returns to the list without writing.

Built-in profiles open in the same page read-only: the fields are visible but
not editable and no save button is shown. Clone one to customize it.

### Routing configuration

- **Selector**: one of `Highest Score (argmax)`, `Weighted Random`,
  `Round Robin`, `Cheapest`, `Lowest Latency`
- **Fallback strategy**: one of `Next Best Candidate`, `Retry After Cooldown`,
  `Abort`
- **Policies**: `health`, `context`, `capability`, `budget-remaining`,
  `rate-limit`, `semantic-intent`, `llm`, `performance`, `fairness`,
  `cheapest`, `model-preference`. Drag to reorder, toggle **Enabled**, remove
  with the trash icon, or add one from the **Add a policy...** dropdown. A
  policy's advanced `config` (when present) is edited as raw JSON; invalid
  JSON blocks saving until fixed.

### Optimizer configuration

The list of installed optimizer steps, in execution order. Drag to reorder and
toggle each step on or off. Steps that are installed but absent from the
profile are listed after the configured ones, so enabling one is a single
click.

### Security configuration

- **Content Guardrails**: `regex`, `semantic`, `topic` and `moderation` rules,
  each with a target (`request`, `response` or `both`) and per-target actions.
  Semantic, topic and moderation rules need a judge model, picked from the
  models configured on this instance
- **PII Policies**: which entities to redact and on which target

Both editors are the same ones the project Security tab uses, so a profile and
an inline project configuration are always edited identically.

---

## Deleting a Profile

Click **Delete** (trash icon) on a custom profile row. A confirmation dialog
warns the action cannot be undone.

Delete can fail with:
- **In use**: a project currently has this profile assigned. Unassign it from
  every project (switch those projects back to Custom, or assign a different
  profile) before deleting.
- **Built-in**: built-in profiles cannot be deleted at all; the Delete button
  is not shown for them.

---

## Related

- [Concepts: Routing: Routing Profiles](../concepts/routing.md#routing-profiles): what a routing profile is, built-in presets, selectors, fallback strategies
- [API: Profiles](../api/management.md#profiles): endpoint reference
- [CLI: profiles](../cli/commands.md#routerly-profiles): the same operations from the terminal
- [Dashboard: Projects](./projects.md#routing-tab): assigning profiles to a project
