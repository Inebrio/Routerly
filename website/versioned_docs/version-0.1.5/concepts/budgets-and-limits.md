---
title: Budgets & Limits
sidebar_position: 6
---

# Budgets & Limits

Routerly has a three-level budget hierarchy that lets you control spending at the platform, project, and individual-token levels. Budgets can be configured for any metric — cost, call count, or token usage — over a rolling or calendar window.

---

## Budget Hierarchy

```
Global budget
└── Project budget
    └── Per-token budget
```

A request must pass **all** applicable budget checks before Routerly forwards it to a provider. If any budget is exhausted, Routerly returns `503 Service Unavailable` with a descriptive message.

---

## Budget Levels

### Global budget

Applies to all requests across all projects. Useful for setting a hard ceiling on total platform spending.

Configure via **Dashboard → Settings → Budgets** or in `settings.json`.

### Project budget

Applies to all requests through a specific project. Configure per project via the **General** tab in the project settings.

### Per-token budget

Applies to requests made with a specific project token. Configured in the project's **Tokens** tab. Per-token limits are useful when different applications share a project and you want to isolate their spending.

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

When a per-token budget is configured, the `mode` field controls how it interacts with the parent project budget:

| Mode | Behaviour |
|------|-----------|
| `replace` | The per-token limit overrides the project limit entirely for this token |
| `extend` | The per-token limit stacks on top of the project limit (both must pass) |
| `disable` | No budget limit for this token, regardless of project limits |

---

## Configuring Budgets

### Dashboard

**Project budget:** Open the project → **General** tab → Budget section.
**Per-token budget:** Open the project → **Tokens** tab → click the edit icon next to a token.
**Global budget:** Open **Settings → Budgets**.

### CLI

You can set a project-level daily or monthly cost budget when adding a model to a project:

```bash
routerly project add-model \
  --slug my-app \
  --model gpt-5-mini \
  --daily-budget 5.00 \
  --monthly-budget 50.00
```

---

## What Happens When a Budget Is Exhausted

- Routerly returns **HTTP 503** with a JSON error body:
  ```json
  {"error":"budget_exceeded","message":"Monthly cost limit for project 'my-app' reached ($50.00)"}
  ```
- The response is immediate — no provider API call is made.
- Once the budget window resets (e.g. at the start of next month), requests are accepted again automatically.

---

## Notifications

You can configure Routerly to send an alert when a budget reaches a configured threshold (e.g. 80% used) or when it is exhausted. See [Concepts: Notifications](./notifications.md) for setup.
