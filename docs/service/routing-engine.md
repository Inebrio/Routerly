---
title: Routing Engine
sidebar_position: 3
---

# Routing Engine

The routing engine is the component responsible for selecting which model receives each request. It runs a configurable stack of **policies** that each score or filter the candidate model set. The highest-scoring model that passes all filters wins.

---

## Request Selection Lifecycle

For each incoming request the engine performs the following steps:

1. **Load candidates** — Read the project's model list. Each candidate carries its `ModelConfig` (id, provider, cost, context window, capabilities, limits) plus any per-model routing guidance (`prompt`) configured on the project.

2. **Pre-filter: budget limits** — Any model that has already exceeded one of its configured spending or token limits is excluded before the policies run. This is a hard pre-check so exhausted models never consume policy computation.

3. **Run policies in priority order** — Enabled policies execute in the order they appear in the project's policy list. Each policy receives the full candidate set and returns:
   - A **score** for each model (`0.0` – `1.0`)
   - Optionally an **excludes** set (hard filters: excluded models are dropped from the candidate set entirely)

4. **Positional scoring** — A base weight is derived from the model's position in the project model list:
   ```
   weight = totalPolicies - policyIndex
   ```
   With 3 enabled policies: position 0 → weight 3, position 1 → weight 2, position 2 → weight 1. This creates a natural preference ordering even when policies produce equal scores.

5. **Aggregate scores** — For each model: `totalScore = sum(policy.score × policy.weight)`.

6. **Select winner** — The model with the highest `totalScore` among non-excluded candidates is chosen. On a tie the first in the project list wins.

7. **Fallback** — If the winning model returns a provider error or timeout, the engine retries with the next-highest scoring candidate. This continues until a model succeeds or the candidate set is exhausted (→ `503`).

---

## Available Policies

### `context`

**Type:** soft filter + scoring

Estimates the token count of the request and checks it against each model's `contextWindow`. Models that cannot fit the request are excluded (score `0.0`). Models in the "danger zone" (>80% of their window consumed) receive a linear penalty down to a minimum of `0.1`.

No configuration options.

**Use when:** your project mixes models with different context window sizes.

---

### `cheapest`

**Type:** scoring

Scores models by cost efficiency. The cheapest model gets `1.0`; others receive a proportional score (`minCost / theirCost`). Free models (e.g. Ollama) always get `1.0` and paid models are capped at `0.999`.

No configuration options.

**Use when:** cost control is the primary goal.

---

### `health`

**Type:** scoring with circuit breaker

Evaluates the weighted error rate for each model in a recent time window using exponential decay (recent errors weigh more than old ones). A Bayesian prior (`pseudoCounts`) prevents over-penalising models with little data.

When the weighted error rate exceeds `circuitBreaker`, the model's score drops to `0.0` (effectively excluded).

| Config key | Default | Description |
|------------|---------|-------------|
| `windowMinutes` | `20` | Look-back window for usage records |
| `halfLifeMinutes` | `5` | Exponential decay half-life — smaller values weight recent errors more |
| `pseudoCounts` | `2` | Bayesian smoothing counts (prior successes) |
| `circuitBreaker` | `0.9` | Weighted error rate threshold that trips the circuit breaker |

Models with no recent records get score `1.0` (optimistic exploration).

**Use when:** you want automatic failover when a provider degrades.

---

### `performance`

**Type:** scoring

Scores models by their recent weighted average latency. The fastest model gets `1.0`; others get `minLatency / theirLatency`. Uses the same exponential decay window as `health`.

Only successful calls (`outcome !== 'error' && outcome !== 'timeout'`) contribute to the average. Models without enough samples (`minSamples`) get `1.0`.

| Config key | Default | Description |
|------------|---------|-------------|
| `windowMinutes` | `20` | Look-back window |
| `halfLifeMinutes` | `5` | Decay half-life (set to `0` for unweighted average) |
| `minSamples` | `1` | Minimum sample count to use the model's data |

**Use when:** response time matters more than cost.

---

### `llm`

**Type:** scoring (uses an LLM to score)

Sends the candidate list and the request to a small "routing LLM" and asks it to score each model's fit for the task. Scores are returned as JSON (`0.0`–`1.0`). The system prompt instructs the routing LLM to match task complexity to model capability (simple tasks → smaller models; complex tasks → stronger models).

Per-model `prompt` guidance (set on the project model entry) is included in the system prompt to give the routing LLM operator-defined hints (e.g. "prefer this model for code tasks").

| Config key | Default | Description |
|------------|---------|-------------|
| `modelId` | _(required)_ | ID of the model to use as the routing LLM |
| `additionalPrompt` | — | Extra instructions injected into the routing system prompt |

**Use when:** you want semantic, task-aware routing without hand-crafting rules.

:::caution Cost
The `llm` policy itself makes an LLM call, which incurs cost and adds latency to every proxied request. Use a small, fast model as the routing LLM.
:::

---

### `capability`

**Type:** hard filter

Inspects the request body and excludes models that explicitly declare they do not support a required capability. Capability mismatches result in score `0.0`.

Detected capabilities:

| Capability | Trigger |
|------------|---------|
| `vision` | Request contains a message with an `image_url` content part |
| `functionCalling` | Request contains `tools` or `functions` |
| `json` | `response_format.type === 'json_object'` |

Models that do not declare a capability (i.e. the field is absent) are assumed compatible — only an explicit `false` triggers exclusion.

No configuration options.

**Use when:** your project includes a mix of models with different capability sets.

---

### `rate-limit`

**Type:** scoring with optional hard threshold

Counts recent calls per model and penalises heavily-used ones to reduce the risk of hitting provider-side rate limits (HTTP 429). Uses proportional scoring: the least-used model gets `1.0`.

Only models that have a `calls` limit configured are scored by this policy; models without a `calls` limit always get `1.0`.

| Config key | Default | Description |
|------------|---------|-------------|
| `windowMinutes` | `1` | Look-back window |
| `maxCallsPerWindow` | — | Hard threshold — models over this are excluded |

**Use when:** you have multiple projects sharing a provider API key with a strict RPM limit.

---

### `fairness`

**Type:** scoring

Distributes traffic evenly across candidates by penalising models that have received a disproportionate share of recent successful calls. Score = `1 - (myShare / totalCalls)`. A model that monopolises all traffic scores `0.0`; a perfectly balanced distribution across N models gives each model `1 - 1/N`.

| Config key | Default | Description |
|------------|---------|-------------|
| `windowMinutes` | `60` | Look-back window for call counts |

**Use when:** you want round-robin-like load distribution across equivalent models.

---

### `budget-remaining`

**Type:** scoring

Scores models by how much budget headroom they have left across all configured limits (global thresholds, project budgets, token budgets). The score is the minimum headroom ratio across all active limits: `(limit - used) / limit`. A model with 80% budget remaining scores `0.8`; a fully exhausted model scores `0.0`.

No configuration options (reads limits from the project and model config).

**Use when:** you want to spread spending across multiple models before any single one runs dry.

---

## Policy Ordering and Weights

Policies are applied in the order configured in the project. Their positional weight (`total − index`) means policies near the top of the list have more influence on the final score. Reorder policies via the dashboard (**Projects → your project → Routing**) or the CLI.

**Example** — 3 policies enabled (health, cheapest, performance):

| Policy | Position | Weight | Score for model A | Weighted score |
|--------|----------|--------|-------------------|----------------|
| health | 0 | 3 | 0.9 | 2.70 |
| cheapest | 1 | 2 | 0.6 | 1.20 |
| performance | 2 | 1 | 0.8 | 0.80 |
| **Total** | | | | **4.70** |

---

## Routing Trace

Every request produces a routing trace that records each policy's scores and decisions. The trace is accessible in the dashboard's Playground view and is identified by the `x-routerly-trace-id` response header.

---

## Related

- [Concepts — Routing](../concepts/routing) — conceptual overview for end users
- [Service — Provider Adapters](./providers) — what happens after a model is selected
- [Dashboard — Playground](../dashboard/playground) — interactive trace viewer
