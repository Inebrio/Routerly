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
routerly project add \
  --name "My App" \
  --slug my-app \
  --models gpt-5-mini,claude-haiku-4-5
```

`--slug` is the URL-safe identifier used in logs and the dashboard. It must be unique.

### Dashboard

1. Open **Projects** in the sidebar
2. Click **+ New Project**
3. Fill in Name, Slug, and optionally an initial model list
4. Click **Create**

---

## Project Tabs

Each project in the dashboard has five tabs:

### General

Shows the project name, slug, default request timeout, and the connection snippet (base URL and a masked token) ready to copy into your code.

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

## Project Slugs

Slugs are used in the scoped proxy URL:

```
POST http://localhost:3000/projects/{slug}/v1/chat/completions
```

Using the scoped URL is optional — you can also use the generic `/v1/chat/completions` with a project token that is already bound to the project.

---

## Listing and Removing Projects

```bash
routerly project list
routerly project remove --slug my-app
```

:::warning
Removing a project deletes all its tokens and budget configuration. Usage records in `usage.json` are preserved for historical reporting.
:::
