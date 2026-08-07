---
title: Routers
sidebar_position: 4
---

# Routers

A **Router** is an isolated workspace inside Routerly, and the entity your
application authenticates against. Every Router has a `kind` — `router`,
`orchestrator`, or `passthrough` — that decides what it targets. This page
covers the default `router` kind; see [Concepts: Architecture](./architecture.md#router-orchestrator-passthrough)
for what distinguishes the three, and [Concepts: Routing](./routing.md) for
how policies pick a model.

A `router`-kind Router has:

- Its own **API tokens** that your applications use to authenticate
- Its own **routing configuration** (which models to use and in what order)
- Its own **budget limits** (optional)
- Its own **usage logs**
- A set of **members** with specific roles (for dashboard access)

---

## Creating a Router

### CLI

```bash
routerly router create --name "My App"
routerly router model add "My App" gpt-5-mini
routerly router model add "My App" claude-haiku-4-5
```

A Router is created empty. Target models are attached one at a time, so each one can carry its own system prompt hint.

### Dashboard

1. Open **Routers** in the sidebar
2. Click **+ New Router**
3. Fill in the Router name and, if the default of 2000 ms does not fit, the TTFT timeout
4. Click **Create**, then open the **Routing** tab to add target models

---

## Router Tabs

Each Router in the dashboard has tabs, including:

### Dashboard

The landing tab: what routing saved against the Router's own target models, latency and TTFT, tokens with the share served from cache, traffic distribution and reliability.

### General

Shows the Router name, the TTFT timeout, and the connection snippet (base URL and a masked token) ready to copy into your code. For an Orchestrator or a Passthrough Router this tab also shows the kind-specific fields (candidates, or the `/passthrough/<slug>` base URL).

### Orchestrator

Only shown on an `orchestrator`-kind Router: the weighted list of candidate Routers it forwards to. See [Concepts: Architecture](./architecture.md#router-orchestrator-passthrough).

### Routing

Configure which models the Router can use and in what order. Drag routing policies into the list and set their parameters. Not shown for an Orchestrator or a Passthrough Router. See [Concepts: Routing](./routing.md) for details.

### Tokens

Manage the Bearer tokens used to authenticate API calls. Each token can have per-token budget limits that stack on top of the Router-level limits. Not shown for a Passthrough Router, which has no Routerly-issued tokens.

**Creating a token:**

1. Click **+ New Token**
2. Give it a name (e.g. `production`, `staging`, `ci`)
3. Optionally configure per-token limits
4. Click **Create** — the token value is shown **once only**

**Per-token limits** allow you to cap spending for individual applications or environments independently of the Router-level budget.

### Users

Assign dashboard users to this Router and control what they can see and do. Available Router-scoped roles: `viewer`, `editor`, `admin`. See [Dashboard: Users & Roles](../dashboard/users-and-roles.md).

### Logs

Live view of recent requests routed through this Router. Columns: timestamp, model used, status, input tokens, output tokens, cost. Click any row to see the full routing trace.

The log table auto-refreshes at a configurable interval (5 s / 15 s / 30 s / 1 min / 5 min).

---

## How a Request Reaches a Router

There is one set of proxy paths, `/v1/...`, and no Router prefix in the URL. The Router is resolved from the Bearer token: a Router token belongs to exactly one Router, so the token alone says which routing configuration, budgets and guardrails apply. (A Passthrough Router is the exception: it is resolved from the `/passthrough/<slug>/...` URL path instead, and carries no Routerly-issued token.)

To send traffic to a different Router, use that Router's token.

---

## Listing and Removing Routers

```bash
routerly router list
routerly router remove "My App"
```

:::warning
Removing a Router deletes all its tokens and budget configuration. Usage records in `usage.ndjson` are preserved for historical reporting.
:::
