---
title: Routing
sidebar_position: 5
---

# Routing

Routerly's router selects which model to use for each request by running a configurable stack of **routing policies**. Policies are applied in priority order; each policy can score, filter, or directly pick a model from the candidate set.

:::tip Benchmarks
Reproducible routing benchmarks — latency overhead, cost savings, and failover behaviour — are published at **[github.com/Inebrio/routerly-benchmark](https://github.com/Inebrio/routerly-benchmark)**.
:::

---

## How Routing Works

1. The project's configured models are loaded as the candidate set.
2. Policies run in the order they appear in the routing configuration.
3. Each policy either **filters** some models out or **scores** them. At the end, the model with the highest combined score is selected.
4. If no model passes all filters, Routerly returns a `503` error with a descriptive message.

### Positional Scoring

Each model's position in the routing list contributes a base score:

```
weight = total_models - index
```

So a model at position 0 gets `weight = N`, the one at position 1 gets `weight = N-1`, etc. This creates a natural preference order even when no other scoring policies are active.

---

## Agent Policies: Overriding Routing per Request

You can define **agent policies** — named sets of preferred models — and apply them on a per-request basis using the `X-Routerly-Policy` request header. This lets you route specific requests outside the normal 10-policy pipeline without changing your global configuration.

### How Agent Policies Work

1. Define one or more agent policies on a project with a unique name, an ordered list of models, and optional cost and latency constraints.
2. When a request arrives with the header `X-Routerly-Policy: my-policy`, Routerly looks up the policy by name.
3. If found, the request is routed through the policy's model list (in order) using the standard fallback loop: try the first model, on failure try the next, etc.
4. If not found, Routerly logs a warning and falls back to normal routing.
5. Agent policy override takes precedence over the semantic response cache, ensuring the policy's model choice is respected.

### Example

Set up an agent policy called `code-expert`:

```json
{
  "name": "code-expert",
  "models": ["gpt-5", "gpt-5-mini"],
  "maxCostUsd": 1.00
}
```

Then send a request with the header:

```bash
curl https://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN" \
  -H "X-Routerly-Policy: code-expert" \
  -d '{ ... }'
```

Routerly will try `gpt-5` first. If it fails or is unavailable, it falls back to `gpt-5-mini`. The normal 10-policy routing pipeline is bypassed.

### Constraints

Agent policies support two optional constraints:

- `maxCostUsd` — maximum estimated cost per request in USD. Recorded on the usage record for cost attribution (enforcement during the request is recorded as a future enhancement).
- `maxLatencyMs` — maximum latency threshold in milliseconds. Recorded on the usage record (in-flight abortion is not possible; this field is recorded as context).

Both constraints are optional. If omitted, no limit is applied.

---

## Available Policies

### `cheapest`

Selects the model with the lowest estimated cost for the current request. Estimation is based on registered pricing and the input token count. Output tokens are estimated at a configurable multiplier.

**Use when:** cost control is the primary concern.

### `health`

Filters out models that have had a high error rate in the recent window, or that failed the last health check. Keeps Routerly routing away from degraded providers automatically.

**Use when:** you want automatic failover.

### `performance`

Scores models by their recent p95 latency. Faster models receive higher scores.

**Use when:** response time matters more than cost.

### `capability`

Filters models by required capabilities (`vision`, `functionCalling`, `thinking`, `json`). Only models that have all required capabilities remain as candidates.

**Use when:** the request requires a specific capability (e.g. image input).

### `context`

Filters out models whose context window is smaller than the current request's estimated token count.

**Use when:** you send long documents or long conversations, and some of your models have smaller context windows.

### `llm`

Uses a separate LLM call to decide which model to route to, based on request content. This policy is experimental and introduces an extra API call per request.

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `thinking` | `boolean` | `false` | If `true` and the routing model supports extended thinking (e.g. Claude with thinking capability), the routing call uses it for more accurate decisions. **Warning:** this increases routing latency significantly. |

**Use when:** you want dynamic model selection based on request semantics.

### `rate-limit`

Filters out models that are currently rate-limited (i.e. received a 429 response recently). The cooldown period is configurable per model.

**Use when:** your usage volume can hit provider rate limits.

### `fairness`

Distributes requests across models to balance load, or ensures that cheaper models are only used up to a configured share of traffic.

**Use when:** you have multiple capable models and want to spread load.

### `budget-remaining`

Scores models by how much of their associated budget is still available. Models with more remaining budget get higher scores.

**Use when:** you have per-model spending limits and want Routerly to naturally prefer models with headroom.

### `semantic-intent`

Classifies each incoming request by semantic intent using embeddings, then restricts the candidate pool to the models you have mapped to that intent.

**How it works:**

1. You define **intents** — each intent has a name, a list of **example phrases** that represent it, and the **target models** that should handle requests of that type.
2. When a request arrives, Routerly embeds the user message and compares it against the centroid of each intent's examples using cosine similarity.
3. Based on the best match score and the gap between the top two intents, the policy produces one of three outcomes:

| Outcome | Condition | Effect |
|---|---|---|
| **Confident** | Top score ≥ threshold and margin ≥ ambiguity gap | Hard-filters candidates to the matched intent's model pool |
| **Ambiguous** | Top score ≥ threshold but gap is too small | Merges the top-2 intent pools |
| **Unknown** | Top score below threshold | No filtering — all candidates pass through |

**Configuration:**

| Option | Default | Description |
|---|---|---|
| `embedding_provider` | _(required)_ | `openai` or `ollama` |
| `embedding_model` | _(required)_ | Model ID to use for embedding (must have the embedding capability) |
| `absolute_threshold` | `0.60` | Minimum cosine similarity score to consider a match |
| `ambiguity_threshold` | `0.08` | Minimum margin between top-2 scores to consider a match confident |

**Use when:** you have distinct request categories that should always be routed to specific models (e.g. billing questions → a fine-tuned model, code requests → a coding model).

:::tip Intent centroids are cached
Embeddings for intent examples are computed once and cached in memory for 1 hour. Changing an intent's examples automatically invalidates the cache.
:::

---

## Configuring Routing

### Dashboard (recommended)

1. Open the project → **Routing** tab
2. Drag a policy from the left panel into the active list
3. Configure the policy's parameters in the settings panel on the right
4. Drag to reorder — policies at the top have higher priority
5. Add target models below the policies

### CLI

```bash
# Add a model to a project with a monthly budget
routerly project add-model \
  --slug my-app \
  --model gpt-5-mini \
  --monthly-budget 10.00

# Remove a model
routerly project remove-model --slug my-app --model gpt-5-mini
```

---

## Example: Cost-first with Health Failover

This configuration tries the cheapest available healthy model:

```
Policies (in order):
  1. health     — remove unhealthy models
  2. cheapest   — prefer lowest cost

Models (in priority order):
  1. gpt-5-nano
  2. gpt-5-mini
  3. gpt-5
```

If `gpt-5-nano` is unhealthy, `health` removes it from candidates, and `cheapest` picks `gpt-5-mini`.

---

## Example: Capability Routing

Route vision requests to a capable model while serving text-only requests with a cheaper model:

```
Policies:
  1. capability  — requires: vision (if the request includes an image)

Models:
  1. gpt-4.1          (has vision)
  2. gpt-5-nano       (no vision)
```

Text-only requests → both are candidates → positional scoring picks `gpt-4.1`. Vision requests → `gpt-5-nano` is filtered out → `gpt-4.1` is used. If no vision model is available, Routerly returns `503`.
