---
title: Projects
sidebar_position: 4
---

# Projects

A **project** is an isolated workspace inside Routerly. Each project has:

- Its own **API tokens** that your applications use to authenticate
- Its own **routing configuration** (which models to use and in what order)
- Its own **budget limits** (optional)
- Its own **usage logs**
- A set of **members** with specific roles (for dashboard access)

---

## Creating a Project

### CLI

```bash
routerly project create --name "My App"
routerly project model add "My App" gpt-5-mini
routerly project model add "My App" claude-haiku-4-5
```

A project is created empty. Target models are attached one at a time, so each one can carry its own system prompt hint.

### Dashboard

1. Open **Projects** in the sidebar
2. Click **+ New Project**
3. Fill in the project name and, if the default of 2000 ms does not fit, the TTFT timeout
4. Click **Create**, then open the **Routing** tab to add target models

---

## Project Tabs

Each project in the dashboard has nine tabs. The most used ones:

### Dashboard

The landing tab: what routing saved against the project's own target models, latency and TTFT, tokens with the share served from cache, traffic distribution and reliability. See [Dashboard: Projects](../dashboard/projects.md).

### General

Shows the project name, the TTFT timeout, and the connection snippet (base URL and a masked token) ready to copy into your code.

### Routing

Configure which models the project can use and in what order. Drag routing policies into the list and set their parameters. See [Concepts: Routing](./routing.md) for details.

### Tokens

Manage the Bearer tokens used to authenticate API calls. Each token can have per-token budget limits that stack on top of the project-level limits.

**Creating a token:**

1. Click **+ New Token**
2. Give it a name (e.g. `production`, `staging`, `ci`)
3. Optionally configure per-token limits
4. Click **Create** — the token value is shown **once only**

**Per-token limits** allow you to cap spending for individual applications or environments independently of the project-level budget.

### Users

Assign dashboard users to this project and control what they can see and do. Available project-scoped roles: `viewer`, `editor`, `admin`. See [Dashboard: Users & Roles](../dashboard/users-and-roles.md).

### Logs

Live view of recent requests routed through this project. Columns: timestamp, model used, status, input tokens, output tokens, cost. Click any row to see the full routing trace.

The log table auto-refreshes at a configurable interval (5 s / 15 s / 30 s / 1 min / 5 min).

---

## How a Request Reaches a Project

There is one set of proxy paths, `/v1/...`, and no project prefix in the URL. The project is resolved from the Bearer token: a project token belongs to exactly one project, so the token alone says which routing configuration, budgets and guardrails apply.

To send traffic to a different project, use that project's token.

---

## Listing and Removing Projects

```bash
routerly project list
routerly project remove "My App"
```

:::warning
Removing a project deletes all its tokens and budget configuration. Usage records in `usage.json` are preserved for historical reporting.
:::
