---
title: Timeline
sidebar_position: 14
---

# Dashboard: Timeline

The Timeline page shows each client request as one ordered sequence: the routing call, guardrail and judge calls, every upstream attempt (including fallbacks), plus MCP tool calls and proxied routes that are not model calls. It sits next to Usage in the sidebar and requires the `report:read` permission; without it the entry is hidden and the page shows a permission message.

---

## Filters

| Filter | Meaning |
|--------|---------|
| **Period** | Same date range picker as Usage |
| **Router** | Requests handled by one router |
| **Token** | One router token (limited to the selected router) |
| **Event kind** | Requests holding at least one event of this kind: attempt, routing, guardrail, judge, MCP, proxy |
| **Outcome** | Success, error, blocked, timeout or budget exceeded |
| **Session ID**, **End user** | Exact match. MCP and proxy events carry neither, so these two filters leave them out |

The cards above the list show the requests, events and cost for every matching request, not only the current page.

---

## Reading the list

Newest request first, 25 per page. Each row shows the start time, router, outcome, number of attempts, a **Fallback** marker when more than one attempt was needed, duration and cost. Click a row to expand its events: kind, model or tool name, outcome, duration and time to first token, tokens, cost, and the block reason or error message when there is one. The link on an event opens its [usage record](usage.md).

A cost of **—** means the cost is unknown; it is never shown as zero. Events without a trace id are shown alone and marked **Not correlated**, they are never merged into another request.

Totals count successful calls only, like [Usage](usage.md), so the two pages agree for the same filters. API: [Timeline](../api/management.md#timeline).
