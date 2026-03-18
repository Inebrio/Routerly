# Budgets & Limits

Routerly's budget system gives you granular control over how much each model can be used.
Limits can be defined at three levels, and the interaction between levels is configurable.

---

## Core Concepts

### Metrics

What you are measuring:

| Metric | Description |
|--------|-------------|
| `cost` | USD spend |
| `calls` | Number of API requests |
| `input_tokens` | Prompt / input tokens |
| `output_tokens` | Completion / output tokens |
| `total_tokens` | Input + output tokens combined |

### Window Types

How the time window is defined:

| Window Type | Description | Example |
|------------|-------------|---------|
| `period` | Calendar-fixed. Resets at a natural boundary (midnight, start of month, etc.) | `"daily"` resets at 00:00:00 every day |
| `rolling` | Sliding window of the last N time units | Last 24 hours, last 60 seconds |

**Period options:** `hourly`, `daily`, `weekly`, `monthly`, `yearly`

**Rolling options:** any positive integer + unit (`second`, `minute`, `hour`, `day`, `week`, `month`)

### Limit Modes

How a limit at one level interacts with limits at the parent level:

| Mode | Behavior |
|------|---------|
| `replace` | (default) This level's limits completely replace the parent's |
| `extend` | This level's limits are stacked on top of the parent's — **all** must pass |
| `disable` | Explicitly disables all limits at this level, ignoring the parent entirely |

---

## Limit Examples

```json
{ "metric": "cost",         "windowType": "period",  "period": "daily",   "value": 5.00   }
→ max $5 per day (resets at midnight)

{ "metric": "cost",         "windowType": "rolling", "rollingAmount": 24, "rollingUnit": "hour", "value": 5.00 }
→ max $5 in any sliding 24-hour window

{ "metric": "calls",        "windowType": "period",  "period": "monthly", "value": 1000   }
→ max 1000 API calls per month

{ "metric": "calls",        "windowType": "rolling", "rollingAmount": 60, "rollingUnit": "second", "value": 10 }
→ max 10 requests per minute (rate limiting)

{ "metric": "input_tokens", "windowType": "period",  "period": "daily",   "value": 500000 }
→ max 500k input tokens per day

{ "metric": "total_tokens", "windowType": "rolling", "rollingAmount": 1,  "rollingUnit": "hour", "value": 200000 }
→ max 200k total tokens per hour
```

---

## Limit Hierarchy

Limits can be set at three levels. The `limitsMode` field controls how they interact:

```
Global (ModelConfig.limits)
    └─ Project (ProjectModelRef.limits)
            └─ Token (TokenModelRef.limits)
```

### Global Limits (per model)

Defined in `ModelConfig.limits`. Apply to **all usage** of that model across all projects and tokens.

```bash
# Set via CLI at model registration time:
routerly model add --id gpt-4o --provider openai --api-key sk-... --monthly-budget 200
```

### Project Limits (per model, per project)

Defined in `ProjectModelRef.limits`. Apply to usage of that model **within a specific project**.

```bash
# Set via CLI when adding a model to a project:
routerly project add-model \
  --project my-app \
  --model gpt-4o \
  --daily-budget 10 \
  --monthly-budget 100
```

The `limitsMode` on the project model ref controls the interaction with global limits:
- `replace` (default): project limits override global completely
- `extend`: **both** global and project limits must pass
- `disable`: no limits for this model in this project, regardless of global

### Token Limits (per model, per project token)

Defined in `TokenModelRef.limits`. Apply to usage of a specific model **by a specific API token**.
Useful for metering individual API consumers within a project.

---

## Budget Pre-filtering

Before routing policies run, Routerly checks every candidate model against all applicable limits.
**Any model that would exceed a limit is removed from the candidate list before scoring begins.**

This means even if a policy gives a model a high score, it will not be selected if it is over budget.

---

## Notifications

Routerly can send alerts when a model approaches its budget. Configure notification thresholds
in the Dashboard > Settings page.

---

## JSON Schema

A complete `Limit` object:

```json
{
  "metric":        "cost | calls | input_tokens | output_tokens | total_tokens",
  "windowType":   "period | rolling",

  // For windowType: "period"
  "period":        "hourly | daily | weekly | monthly | yearly",

  // For windowType: "rolling"
  "rollingAmount": 24,
  "rollingUnit":   "second | minute | hour | day | week | month",

  "value": 5.00
}
```

---

## See Also

- [CLI: model add](../cli/commands.md#model-add) — set global limits via CLI
- [CLI: project add-model](../cli/commands.md#project-add-model) — set project limits via CLI
- [Dashboard: Projects](../dashboard/projects.md) — manage limits via UI
