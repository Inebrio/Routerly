---
title: Projects
sidebar_position: 4
---

# Dashboard: Projects

The Projects page gives you an overview of all projects and provides access to each project's configuration.

---

## Projects List

The list shows each project's name, slug, number of tokens, assigned models, and a summary of today's cost and call count.

Click any project to open its detail view, which has five tabs.

---

## General Tab

Shows and lets you edit:

- **Name** — display name for the project
- **Slug** — URL-safe identifier (read-only after creation)
- **Default Timeout** — per-request timeout in milliseconds (overrides the global `defaultTimeoutMs`)
- **Connection Info** — base URL and masked token snippet ready to copy into your SDK configuration
- **Budget** — project-level cost limit (daily / monthly)

---

## Routing Tab

Configure which models this project can use and how to select between them.

### Adding Models

Use the **+ Add Model** button to pick from registered models. Models appear in a numbered list — their order determines the default routing priority (position 0 is highest).

Drag and drop to reorder.

### Adding Policies

Drag policies from the policy panel on the right into the active-policies list on the left. Each policy can be expanded to configure its parameters.

Available policies: `cheapest`, `health`, `performance`, `capability`, `context`, `llm`, `rate-limit`, `fairness`, `budget-remaining`.

See [Concepts: Routing](../concepts/routing.md) for each policy's behaviour and parameters.

---

## Tokens Tab

Manage Bearer tokens for this project.

### Creating a Token

1. Click **+ New Token**
2. Enter a **Name** (e.g. `production`, `staging`, `ci`)
3. Optionally configure per-token limits (metric, limit value, window type, mode)
4. Click **Create**

The token value (`sk-rt-…`) is shown **once**. Copy it immediately.

### Per-Token Limits

Per-token limits let you cap spending for individual applications sharing the same project. The `mode` field controls how the per-token limit interacts with the project-level limit:

| Mode | Behaviour |
|------|-----------|
| `replace` | Per-token limit overrides the project limit for this token |
| `extend` | Both per-token and project limits must pass |
| `disable` | No budget check for this token |

### Rolling or Regenerating a Token

Click the **Re-generate** icon to invalidate the current token and issue a new one. The previous token stops working immediately.

---

## Users Tab

Assign dashboard users to this project. A user assigned here can see and manage the project based on their role's permissions.

Available roles: `viewer`, `editor`, `admin` (or any custom role defined in [Users & Roles](./users-and-roles.md)).

---

## Logs Tab

A live log of recent requests routed through this project.

| Column | Description |
|--------|-------------|
| Timestamp | When the request arrived |
| Model | Provider model that handled the request |
| Status | `success`, `error`, `budget_exceeded`, etc. |
| Input Tokens | Number of input tokens |
| Output Tokens | Number of output tokens generated |
| Cost | Estimated USD cost |

Click any row to open the **Trace view** which shows the full routing decision: which policies ran, which models were considered, and why the final model was chosen.

The table auto-refreshes at a configurable interval. Use the interval selector (5 s / 15 s / 30 s / 1 min / 5 min / Off) to control polling.
