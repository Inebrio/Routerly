---
title: Usage
sidebar_position: 5
---

# Dashboard: Usage

The Usage page provides aggregate analytics and per-request logs across all projects. Use it to understand spending patterns, investigate errors, and drill into individual request traces.

---

## Summary Statistics

The top row shows aggregated totals for the selected filter set:

- Total cost (USD)
- Total call count
- Success rate
- Error count
- Average latency

---

## Filters

| Filter | Description |
|--------|-------------|
| **Date range** | Start and end date/time picker |
| **Project** | Filter to one or more projects |
| **Model** | Filter to specific model IDs |
| **Type** | `chat`, `responses`, `messages` |
| **Outcome** | `success`, `error`, `budget_exceeded`, `timeout` |

Filters are applied immediately; the page updates in real time.

---

## Usage Table

The table lists individual requests with:

| Column | Description |
|--------|-------------|
| Timestamp | When the request arrived |
| Project | The project the request belonged to |
| Model | Provider model used |
| Type | API type (`chat`, `responses`, `messages`) |
| Status | Outcome |
| Input Tokens | Input token count |
| Output Tokens | Output token count |
| Cost | Estimated cost in USD |
| Latency | Time to first byte / total response time |

Click any row to open the full **Trace view**.

---

## Trace View

The trace view shows the complete lifecycle of a single request:

1. **Router Request** — the routing engine's input: the project slug, requested model (if any), and active policies
2. **Router Response** — which model was selected and why (policy scores listed)
3. **Model Request** — the actual payload sent to the provider
4. **Model Response** — the raw provider response including all tokens and finish reason

This detail is useful for debugging unexpected model selections, routing failures, or provider errors.

---

## Live Polling

The usage table can auto-refresh to show new requests as they arrive. Use the interval selector in the top-right:

| Interval | Meaning |
|----------|---------|
| 5 s | Refresh every 5 seconds |
| 15 s | Refresh every 15 seconds |
| 30 s | Refresh every 30 seconds |
| 1 min | Refresh every minute |
| 5 min | Refresh every 5 minutes |
| Now | Manual refresh only |

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
