# Usage Analytics

Routerly records every LLM call with full metadata. The dashboard provides two views for
exploring this data: the **Overview** page (summary) and the **Usage** page (detailed analytics).

---

## Overview Page

The Overview is the landing page after login. It shows:

### Summary Cards

| Card | Description |
|------|-------------|
| **Total spend** | Cumulative cost for the selected time range |
| **Total calls** | Number of API requests |
| **Total tokens** | Input + output tokens combined |
| **Active projects** | Projects with at least one call in the period |

### Cost Timeline Chart

A line chart showing cumulative or daily cost over time. Use the date range picker to zoom in.

### Cost by Model (Pie Chart)

Breakdown of spend by model ID for the selected period. Hover over a slice to see exact values.

### Recent Usage Table

A paginated table of the most recent API calls, showing:
- Timestamp
- Project
- Model selected
- Input / output tokens
- Cost
- Latency (ms)
- Outcome (success / error)

---

## Usage Page

Navigate to **Usage** ('usable' in the sidebar) for a full analytics view with filtering.

### Date Range Filter

Use the date range picker to select a custom time window. Presets include:
- Today
- Last 7 days
- Last 30 days
- This month
- Custom range

### Model Filter

Multi-select dropdown to filter by one or more model IDs.

### Project Filter

Multi-select dropdown to filter by one or more projects.

### Usage Table

The filtered usage table shows one row per API call:

| Column | Description |
|--------|-------------|
| Timestamp | Date and time of the request |
| Project | Project that made the request |
| Model | Model that handled the request |
| Input tokens | Prompt token count |
| Output tokens | Completion token count |
| Cost | USD cost for this call |
| Latency | End-to-end response time in milliseconds |
| Status | `success` or `error` |

### Usage Record Detail

Click on any row to open the **Usage Record** page with the full call details:
- Request body summary
- Response summary
- Routing trace (same view as Project > Logs)
- Token breakdown (input, output, cached)
- Cost breakdown

---

## Understanding Costs

Cost is calculated per call:

```
cost = (input_tokens × inputPerMillion / 1_000_000)
     + (output_tokens × outputPerMillion / 1_000_000)
     + (cached_tokens × cachePerMillion / 1_000_000)  [if applicable]
```

For models with **tiered pricing** (e.g. OpenAI's context-length-based tiers), the appropriate
rate is automatically selected based on the total context size.

All costs are in **USD**.

---

## Usage Record Storage

All records are stored in:

```
~/.routerly/data/usage.json
```

This is an append-only JSON array. It grows over time, for long-running deployments, consider
archiving or rotating it periodically.

---

## See Also

- [CLI: report commands](../cli/commands.md#report): generate cost reports from the terminal
- [Budgets & Limits](../service/budgets-and-limits.md): enforce spend caps based on usage
