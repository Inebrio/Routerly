---
title: Usage
sidebar_position: 6
---

# Dashboard: Usage

The Usage page provides aggregate analytics, per-model performance breakdown, and per-request logs across all projects. Use it to understand spending patterns, investigate errors, and drill into individual request traces.

---

## Summary Statistics

The top row shows aggregated totals for the selected filter set:

![Usage page showing the filter bar, the summary cards, and the per-model breakdown](../assets/screenshot-usage.png)

| Card | Description |
|------|-------------|
| **Total Cost** | USD cost of all successful calls in the period. When routing came out ahead, a bar draws the counterfactual bill to scale: the coloured part is what was paid, the gap is what routing saved, and the caption names the model it is compared against. A saving of zero or less gets no bar. |
| **Tokens** | Tokens in and out for the period, in compact form (`1.2k`, `4.3M`), split to scale by a bar. The caption breaks it into in, out and, when the provider served any, cached. When optimizers cut tokens, their measured total is the second line; otherwise it is the estimated difference against always using the comparison model. |
| **Total Calls** | All usage records (completion + routing + guardrail + blocked) |
| **Completion Calls** | Main model inference calls, with their total cost |
| **Router Calls** | Model calls the router makes to decide where to route: the `llm` policy's decision call and the `semantic-intent` policy's embedding call, with their cost |
| **Guardrail Calls** | Model calls made by security rules (semantic, topic, moderation), with cost |
| **Blocked Calls** | Requests blocked by a guardrail rule before reaching any model. Shown only when at least one blocked call exists in the period. |
| **Errors** | Failed model calls -- blocked calls are counted separately and excluded from this number |

The **Completion Calls** and **Router Calls** cards double as filters: clicking
one sets the Caller filter to that kind and outlines the card, clicking it again
clears the filter.

Guardrail judge calls are charged to the project like any other model call and are subject to the project's budget limits. Blocked requests record zero cost and zero tokens.

What routing saved is read on the two cards that carry the numbers it changed:
money on **Total Cost**, tokens on **Tokens**. There is no separate saving card,
and no time-saved figure.

---

## What Routing Saved

Below the summary cards, the same chart the [Overview](overview.md#what-routing-saved)
carries, over the filtered records rather than the whole instance: what the
traffic cost, moved and took, against what the same calls would have cost, moved
and taken on each single model that could have served them. The metric selector
switches between **Cost**, **Tokens** and **Speed**, and the legend toggles each
model line.

It follows every filter on the page but does not follow the live refresh: the
comparison is expensive, so it is recomputed when the window or the filters
change, not every two seconds.

---

## Filters

| Filter | Description |
|--------|-------------|
| **Period** | Preset time window (today, this month, etc.) or custom range |
| **Project** | Filter to a specific project |
| **Model** | Filter to specific model IDs |
| **Caller** | Who made the call: the client (`Completion`), the router, the guardrail pipeline, or an experiment judge |
| **Type** | What the call asked for, taken from the endpoint the client hit: `Chat`, `Text Completion`, `Embedding`, `Rerank`, `Image`, `Audio` |
| **Status** | `All`, `Success`, `Blocked`, or `Error` -- `Blocked` shows only guardrail-blocked requests |
| **Session ID** | Filter to requests from a specific session (from the `x-routerly-conversation-id` header) |
| **Tags** | Filter by token metadata (e.g., `environment: production`) |

**Caller** and **Type** only offer the values the selected window actually
contains, each with its call count next to it, and disappear entirely when there
is nothing to choose: an instance serving only chat completions gets neither
group. The counts are taken before those two filters are applied, so picking a
value never changes the list you picked it from.

Filters are applied immediately and affect the summary cards, the savings block, the per-model breakdown table, and the request log simultaneously.

Every filter, including the period, is kept in the browser: a refresh, or coming
back to the page later, restores the view you were looking at rather than the
defaults. Use **Reset** to go back to the defaults.

The date range picker offers no future date: days after today are dimmed and not
clickable, and the calendar stops at the current month.

:::tip Session tracking and custom metadata
Use the **Session ID** filter to view all requests from a specific conversation or user session. Use the **Tags** filter to analyze traffic by team, environment, application, or any custom dimension you tag your tokens with.
:::

---

## Per-Model Breakdown

Below the summary cards, a table ranks all models that received traffic in the selected period.

| Column | Description |
|--------|-------------|
| **Rank** | Position in the cost-performance ranking; a model with no ranking data shows a dash and always sorts last |
| **Model** | Provider model identifier |
| **Provider** | Provider name |
| **Calls** | Total requests in the period |
| **Errors** | Failed calls |
| **Success Rate** | Percentage of successful completions |
| **Avg Latency** | Mean response time |
| **P95 Latency** | 95th-percentile response time |
| **Input Tokens** | Total input tokens consumed |
| **Output Tokens** | Total output tokens produced |
| **Cost / 1K** | Average cost per 1,000 tokens |
| **Cost (USD)** | Total spend for this model in the period |

A star marks the model with the best cost-performance ratio based on your own
traffic. Every column header sorts. The table respects all active filters.

:::note Redirected from /dashboard/leaderboard
The standalone Leaderboard page has been merged into this page. `/dashboard/leaderboard` redirects to `/dashboard/usage`.
:::

---

## Usage Table

**Recent Calls** lists individual requests, newest first. The heading counts how
many records the active filters kept out of the period's total.

| Column | Description |
|--------|-------------|
| Time | When the request arrived |
| Project | The project the request belonged to |
| Model | Provider model used |
| Type | What the call asked for: `Chat`, `Text Completion`, `Embedding`, `Rerank`, `Image`, `Audio` |
| Caller | Who made the call: `completion` (the client), `router`, `guardrail`, or `judge` |
| In / Out | Input and output token counts |
| Cost | Estimated cost in USD, to three significant digits; anything below a millionth of a dollar shows as `<$0.000001` |
| Latency | Total response time |
| TTFT | Time to first token, for streamed responses |
| Tok/s | Output tokens per second |
| Status | Outcome |

Every numeric column is right-aligned and uses tabular figures, so the digits
line up down the column.

A call Routerly made on its own behalf (`router`, `guardrail`, `judge`) is
marked twice: its Caller cell is a coloured badge, and the whole row carries a
matching coloured bar on the left edge. Client completions, which are the bulk
of the rows, stay unmarked.

![Call log filtered to router calls, each row badged and bordered in the router colour](../assets/screenshot-usage-calls.png)

The **Status** badge in the table uses colour coding:

| Outcome | Badge colour |
|---------|-------------|
| `success` | Green |
| `blocked` | Amber |
| `error` / other | Red |

Click any row to open the full **Trace view** (`/dashboard/usage/<record id>`).

### Trace View

The trace view shows the complete lifecycle of a single request, in the order
the pipeline walked it. Entries are grouped by **phase**, the stage of the
pipeline that produced them:

| Phase | What happened there |
|-------|---------------------|
| **Ingress** | The request arrived and was identified: project, token, session |
| **Request · Preprocess** | Everything that ran on the way in: PII scan and scrub, guardrail rules, optimizers |
| **Routing · Prepare** | The routing engine's input and its decision: active policies, scored candidates, selected model |
| **Routing · Execute** | The call to the provider: payload sent, response received, retries and fallbacks |
| **Response · Postprocess** | Everything that ran on the way out: response-side guardrails, PII scrub |
| **Finalize** | Cost and token accounting, and the export of the finished trace |

Each phase header carries the modules that spoke in it (`pii`, `guardrail`,
`router`, `policy`, `model`, `cost`), the number of events, and how long the
phase took. Click it to fold the phase away. Inside, every entry is stamped with
its offset from the start of the request (`+83 ms`), so a slow phase is visible
without reading the numbers.

A phase only appears when a module emitted something in it: a project with no
guardrails and no PII scrubbing gets no **Request · Preprocess** section.

:::note Traces recorded before 0.4.0
Older records carry no phase on their entries. Those fall back to the previous
grouping -- Router Request, Router Response, Model Request, Model Response --
and are shown unchanged.
:::

The trace also includes guardrail and PII entries when those features are active:

| Trace entry | When |
|-------------|------|
| `guardrail:evaluated` | After every guardrail check -- shows each rule's `outcome` (`passed`, `triggered`, or `skipped`) and `reason`, even when no rule fires |
| `guardrail:triggered` | A request-side rule matched with log action (request continued) |
| `guardrail:response-triggered` | A response-side rule matched with log action (response continued) |
| `pii:scrubbed` | PII was detected and replaced in the request or response |

For a **blocked** request (judged rule that triggers), the trace includes the `guardrail:evaluated` entry and the block message (from the judge's reason field, or a built-in default if the judge fails). The block message is stored on the trace only and is not included in the wire response sent to the client.

The **detail panel** for each usage record shows:

| Field | Description |
|-------|-------------|
| **Guardrail Triggered** | Identifier of the first rule that fired (e.g. `regex:pattern`, `injection:dan-mode`, `topic:gpt-4o-mini`) |
| **Blocked By** | Same as Guardrail Triggered -- present only when `outcome` is `blocked` |
| **PII Redacted** | Comma-separated list of entity types redacted (e.g. `EMAIL, PHONE`) |
| **Session ID** | Session identifier from the `x-routerly-conversation-id` header, if provided (useful for grouping multi-turn conversations or user sessions) |
| **Tags** | Custom metadata from the token that made the request (e.g., `environment: production`, `team: backend`); enables filtering and analysis by custom dimensions |

### Live Polling

The page starts in **Live** mode, which refreshes every 2 seconds. A red pulsing badge appears next to the page title while Live is active.

To change the refresh interval, click any option in the interval selector directly. Doing so automatically exits Live mode and applies the selected interval:

| Interval | Meaning |
|----------|---------|
| **Live** | Refresh every 2 seconds (default on page load) |
| Off | Manual refresh only (click the refresh button) |
| 5 s | Refresh every 5 seconds |
| 15 s | Refresh every 15 seconds |
| 30 s | Refresh every 30 seconds |
| 1 min | Refresh every minute |
| 5 min | Refresh every 5 minutes |

The **Period** filter (date range picker) works independently of Live mode. You can change the displayed time window at any time, even while Live polling is active, without turning it off first.

---

## Exporting Usage Data

Usage data is stored in `~/.routerly/data/usage.json` as newline-delimited JSON. You can process it with any standard tool:

```bash
# Total cost this month
cat ~/.routerly/data/usage.json | \
  jq -r 'select(.timestamp | startswith("2025-07")) | .cost' | \
  awk '{sum+=$1} END {printf "Total: $%.4f\n", sum}'
```

For programmatic access, use the [Usage API](../api/management.md#usage).
