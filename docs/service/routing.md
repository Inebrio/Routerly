# Routing Engine

The routing engine is the core of Routerly's intelligence. For every incoming request, it determines
which model should handle it by combining scores from up to 9 configurable policies.

---

## Overview

Routing happens in three stages:

```
1. Routing Model        → produces initial weighted candidate list
2. Budget Pre-filter    → removes over-budget candidates
3. Policy Scoring       → all enabled policies run in parallel, scores combined
```

The model with the highest combined score that is within budget receives the request.
If it fails (timeout, error), Routerly falls back to the next candidate automatically.

---

## The Routing Model

Every project has a designated **routing model** — an LLM that is invoked first to analyze the
incoming request and assign initial weights to each candidate model. This is typically a small,
fast, inexpensive model (e.g. `gpt-4o-mini`).

The routing model receives the request context and returns a ranked list like:

```json
{
  "models": [
    { "model": "gpt-4o",     "weight": 0.9, "reason": "Complex reasoning task" },
    { "model": "llama3",     "weight": 0.4, "reason": "Could handle simple parts" },
    { "model": "gpt-4o-mini","weight": 0.2, "reason": "May lack capability" }
  ]
}
```

---

## The 9 Routing Policies

Policies are enabled per-project and ordered. The **position order matters**: the first policy in the
list has weight `N` (number of policies), the last has weight `1`. Scores are multiplied by position
weight before being combined.

| Policy | Type | What it does |
|--------|------|-------------|
| `context` | Smart | Analyzes the request content (task type, complexity) to prefer the most suitable model |
| `cheapest` | Cost | Prefers the model with the lowest cost per token |
| `health` | Availability | Checks recent error rates; penalizes models with recent failures |
| `performance` | Latency | Prefers models with lower observed latency |
| `llm` | Smart | Delegates the routing decision to another LLM ("which model should I use?") |
| `capability` | Match | Matches request requirements to model capabilities (vision, function calling, thinking, JSON mode) |
| `rate-limit` | Safety | Penalizes models close to their rate limit headroom |
| `fairness` | Balance | Distributes load across models, avoiding hot spots |
| `budget-remaining` | Safety | Prefers models with more budget headroom remaining |

### Policy Configuration

Policies are configured per-project as an ordered array:

```json
{
  "policies": [
    { "type": "capability",       "enabled": true },
    { "type": "budget-remaining", "enabled": true },
    { "type": "cheapest",         "enabled": true },
    { "type": "health",           "enabled": true },
    { "type": "performance",      "enabled": false }
  ]
}
```

The first policy in the array has the highest weight. Only `enabled: true` policies are scored.

---

## Scoring and Selection

After all policies run in parallel, scores are combined using positional weights:

```
final_score(model) = Σ (policy_score × position_weight)
```

Where `position_weight` for a policy at index `i` (0-based) among `N` enabled policies is `N - i`.

For example, with 3 enabled policies in order [capability, cheapest, health]:
- `capability` gets weight `3`
- `cheapest` gets weight `2`
- `health` gets weight `1`

The model with the highest `final_score` is selected.

---

## The Trace System

Every request gets a **trace ID** (UUID) attached. Each policy and routing step emits structured
trace entries that describe what happened and why. These are:

- Available in the response header: `x-routerly-trace-id`
- Streamed as `data: {"type":"trace","entry":{...}}` events during SSE
- Visible in the Dashboard > Project > Logs tab
- Retrievable via `GET /api/traces/:traceId`

A trace entry looks like:

```json
{
  "step": "policy:cheapest",
  "model": "gpt-4o-mini",
  "score": 0.95,
  "reason": "Lowest cost: $0.15/1M input tokens",
  "timestamp": "2026-01-01T00:00:01.234Z"
}
```

---

## Single-Candidate Bypass

When budget pre-filtering leaves only one candidate, the entire policy scoring stage is skipped
and that candidate is selected directly. This optimizes latency for projects with a single model.

---

## Fallback Behavior

If the selected model fails (network error, timeout, provider error):

1. Routerly logs the failure in the trace
2. The next candidate in the ranked list is tried
3. This continues until a model succeeds or all candidates are exhausted
4. If all candidates fail → `HTTP 503 Service Unavailable`

---

## See Also

- [Routing Policies Reference](../reference/../service/../cli/../service/routing.md) — detailed per-policy documentation
- [Budgets & Limits](budgets-and-limits.md) — how budget pre-filtering works
- [Projects](../dashboard/projects.md) — how to configure policies per-project in the dashboard
