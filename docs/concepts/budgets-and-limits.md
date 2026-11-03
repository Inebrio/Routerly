---
title: Budgets & Limits
sidebar_position: 6
---

# Budgets & Limits

Routerly has a three-level budget hierarchy that lets you control spending at the platform, router, and individual-token levels. Budgets can be configured for any metric — cost, call count, or token usage — over a rolling or calendar window.

---

## Budget Hierarchy

```
Global budget
└── Router budget
    └── Per-token budget
```

A request must pass **all** applicable budget checks before Routerly forwards it to a provider. If any budget is exhausted, Routerly returns `503 Service Unavailable` with a descriptive message.

:::caution Passthrough routers are not covered
None of the budget or limit checks on this page apply to **Passthrough** routers. A Passthrough router forwards the request with the client's own upstream credential and no model resolution, so Routerly has no price to attribute — usage records for that traffic always show `cost: null`. Set budgets on the model or token as usual for regular routers; a Passthrough router bypasses them entirely, by design, regardless of any budget configured elsewhere in the account.
:::

---

## Budget Levels

### Global budget

Applies to all requests across all routers. Useful for setting a hard ceiling on total platform spending.

Configure via **Dashboard → Settings → Budgets** or in `settings.json`.

### Router budget

Applies to all requests through a specific router. Configure per router via the **General** tab in the router settings.

### Per-token budget

Applies to requests made with a specific router token. Configured in the router's **Tokens** tab. Per-token limits are useful when different applications share a router and you want to isolate their spending.

### Spend groups (org / team)

Spend groups add an org- and team-level tier on top of the model/router/token
limits, giving a full cascade:

```
Organisation group
└── Team group
    └── Router (spendGroupId) → per-token budget
```

A router joins a group via its `spendGroupId`, and groups nest via
`parentGroupId`. Usage is attributed to a group by the routers that belong to
it and to its descendant groups. When a request runs through a router in a
group, every group in the parent chain must have budget remaining, in addition
to the per-model/router/token checks. **Child group limits cannot exceed their
parent's matching limit** — this is validated when creating or updating a group.

Spend groups use the same `Limit` shape (metrics, period/rolling windows) as the
other levels. Manage them via the `/api/spend-groups` endpoints (see the
[Management API reference](../api/management.md#spend-groups)).

---

## Metrics

Each budget limit tracks one metric:

| Metric | Description |
|--------|-------------|
| `cost` | USD cost calculated from token prices |
| `calls` | Total number of API requests |
| `input_tokens` | Total input tokens consumed |
| `output_tokens` | Total output tokens generated |
| `total_tokens` | Sum of input and output tokens |

---

## Window Types

Budgets reset based on the configured window type.

### Period windows

Reset at the start of each calendar period:

| Window | Resets |
|--------|--------|
| `hourly` | Top of each hour |
| `daily` | Midnight (UTC) |
| `weekly` | Monday midnight (UTC) |
| `monthly` | 1st of each month |
| `yearly` | January 1st |

### Rolling windows

Track usage over a sliding time window:

| Window | Period |
|--------|--------|
| `rolling_second` | Last 1 second |
| `rolling_minute` | Last 60 seconds |
| `rolling_hour` | Last 3,600 seconds |
| `rolling_day` | Last 86,400 seconds |
| `rolling_week` | Last 7 days |
| `rolling_month` | Last 30 days |

---

## Limit Modes (per-token budgets)

When a per-token budget is configured, the `mode` field controls how it interacts with the parent router budget:

| Mode | Behaviour |
|------|-----------|
| `replace` | The per-token limit overrides the router limit entirely for this token |
| `extend` | The per-token limit stacks on top of the router limit (both must pass) |
| `disable` | No budget limit for this token, regardless of router limits |

---

## Configuring Budgets

### Dashboard

**Global budget (per model):** Open **Models**, edit the model, then the **Limits** section.
**Per-token budget:** Open the router → **Tokens** tab → click the edit icon next to a token. The editor shows the limit inherited from the model so you can see what you are overriding.

### CLI

Global limits are set on the model, either with the two cost shorthands or with the full limits array:

```bash
routerly model edit gpt-5-mini --daily-budget 5.00 --monthly-budget 50.00

routerly model edit gpt-5-mini --limits-json \
  '[{"metric":"cost","windowType":"period","period":"monthly","value":100},
    {"metric":"calls","windowType":"rolling","rollingAmount":1,"rollingUnit":"minute","value":60}]'
```

Per-token limits are set on the token, one spec per model:

```bash
routerly router token edit "My App" <token-id> \
  --add-limit "gpt-5-mini:cost:period:daily:5"
```

:::note
The router level (`limits` on a router's model entry) is honoured at request time but has no dashboard or CLI editor yet: it can only be written directly in `routers.json`. Set budgets on the model or on the token instead.
:::

---

## What Happens When a Budget Is Exhausted

- Routerly returns **HTTP 503** with a JSON error body:
  ```json
  {"error":"budget_exceeded","message":"Monthly cost limit for router 'my-app' reached ($50.00)"}
  ```
- The response is immediate — no provider API call is made.
- Once the budget window resets (e.g. at the start of next month), requests are accepted again automatically.

---

## Notifications

You can configure Routerly to send an alert when a budget reaches a configured threshold (e.g. 80% used) or when it is exhausted. See [Concepts: Notifications](./notifications.md) for setup.
