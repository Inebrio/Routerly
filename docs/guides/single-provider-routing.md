---
title: Route automatically within one provider
sidebar_label: One-provider routing
sidebar_position: 7
---

# Route automatically within one provider

Routerly can pick the best model for each request while keeping every request
on a single provider (for example OpenAI only, or Anthropic only). No setting
is needed: a router only considers the models you attach to it, so a router
whose models all belong to one provider never leaves that provider.

This guide is a recipe, run end to end on Routerly 0.6.x with a real OpenAI
account (the model ids and prices below are the ones used in the run).

## What "the pool" is

- The candidates of a request are the **models attached to the router**
  (`routerly router model add`), limited to models on enabled connections.
- The pool is **static**: it is exactly what you configured. A model that is
  registered in Routerly (for example another provider's model, or a model you
  later add to the registry) is **not** a candidate until you attach it to the
  router. Routerly does not add models to a router on its own, and this guide
  describes no discovery feature.
- A model named by the client that is not in the pool is not forwarded as
  asked: the router still picks from its own pool.

## Recipe

Assumes a running service and `routerly auth login` done.

```bash
# 1. One connection, three models of the same provider
routerly connections add --provider-id openai --label openai --api-key sk-...
routerly model add --id gpt-5-nano --provider openai --connection openai --input-price 0.05 --output-price 0.4
routerly model add --id gpt-5-mini --provider openai --connection openai --input-price 0.25 --output-price 2

# 2. One router whose pool is those models
routerly router create --name single-openai
routerly router model add single-openai gpt-5-nano
routerly router model add single-openai gpt-5-mini

# 3. Policies, in priority order (first = highest weight)
routerly router routing policy enable single-openai model-preference
routerly router routing policy enable single-openai health
routerly router routing policy enable single-openai capability
routerly router routing policy enable single-openai context
routerly router routing policy enable single-openai cheapest

# 4. A client token (shown once)
routerly router token create single-openai --labels my-app
```

The same configuration is available in the dashboard (**Routers › single-openai
› Routing**: policies and target models) and through the management API
(`POST /api/routers`, `PUT /api/routers/:id`; see the
[API reference](../api/management.md)).

What each policy contributes here (see [Routing](../concepts/routing.md)):

| Policy | Role in a one-provider pool |
|--------|-----------------------------|
| `health` | Down-ranks models with recent errors; opens a circuit so a failing model is skipped. |
| `capability` | Removes models that lack a feature the request needs (vision, tools, JSON mode). |
| `context` | Removes models whose context window cannot hold the request. |
| `cheapest` | Prefers the lowest-cost model (needs model prices, set above). |
| `model-preference` | Lets a client name a model; see below. |

## Send requests

Use the router token as the API key; both lanes work, streaming or not. With
`routerly/ada` (or any model the client does not need to choose) the router
decides.

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-rt-..." -H "Content-Type: application/json" \
  -d '{"model":"routerly/ada","messages":[{"role":"user","content":"Reply ok"}]}'

curl http://localhost:3000/v1/messages \
  -H "x-api-key: sk-rt-..." -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
  -d '{"model":"routerly/ada","max_tokens":200,"messages":[{"role":"user","content":"Reply ok"}]}'
```

Observed on the reference run (pool: `gpt-5-nano`, `gpt-5-mini`; the registry
also held `gpt-4.1-nano` and `claude-haiku-4-5`, not attached):

| Request | Served by |
|---------|-----------|
| OpenAI lane, `routerly/ada`, stream and non-stream | `gpt-5-nano` (cheapest) |
| Anthropic lane, `routerly/ada`, stream and non-stream | `gpt-5-nano` |
| Client asks for `claude-haiku-4-5` or `gpt-4.1-nano` (registered, not in pool) | `gpt-5-nano`: the pool decides |

Every request stayed on OpenAI and inside the pool.

## model-preference and the virtual model

`routerly/ada` is the virtual model: it means "you choose". With it,
`model-preference` abstains and the other policies decide. When the client
names a pool model, `model-preference` gives that model its bonus (default
`1.0`), so it wins **only if the policy weighs enough against the others**.
Policy weight comes from position: the first enabled policy weighs most.

- `model-preference` last in the list: asking for `gpt-5-mini` was **not**
  honoured (`cheapest` outweighed it; served `gpt-5-nano`).
- `model-preference` first (`routerly router routing policy reorder
  single-openai model-preference,health,capability,context,cheapest`): asking
  for `gpt-5-mini` was honoured on both lanes; `routerly/ada` still went to
  `gpt-5-nano`.

## Failure and fallback

Attach a model that fails upstream next to the working ones (here
`gpt-4.1-nano`, which the account could no longer use: upstream answered
`404 ... has been deprecated`). It ranked first as the cheapest. The trace of
that request shows:

```
router:result   final: gpt-4.1-nano, gpt-5-nano, gpt-5-mini
model:error     gpt-4.1-nano  404 ... has been deprecated
model:request   gpt-5-nano
trace:recap     outcome ok, attempts 2, errors: [gpt-4.1-nano]
```

The client got a normal `200` from `gpt-5-nano`. The retry walks the **rest of
the ranked pool**, never another provider. The failed model then gets a
circuit (`resilience:excluded`) and is skipped on the next requests until its
cooldown ends.

## When no model is eligible

All observed on the reference run, same router, both lanes:

| Situation | Result |
|-----------|--------|
| Every pool model over its budget limit | `429` `Usage limit exceeded for every model of this router.` (OpenAI `insufficient_quota`, Anthropic `rate_limit_error`) |
| Pool reduced to the single failing model | that model's own upstream error is returned as is (here `404 model_not_found`), also on repeat requests while its circuit is open |
| Every model removed by policy exclusion, or the router has no resolvable model | `503` `No model of this router is currently available.` (the last upstream error replaces it when one is known) |

Routerly never falls back to another provider by itself. To add one on
purpose, attach its models to the router, or put the router in an
[orchestrator](../concepts/architecture.md#router-orchestrator-passthrough).

## Read the decision

Each request's routing trace is stored on its usage record:
`GET /api/usage?limit=10`, then `GET /api/usage/<id>` (field `trace`), or the
Usage page and the Playground in the dashboard. The entries used above are
`router:policies` (candidates), `policy:result:<type>` (scores),
`router:result` (final order), `model:error` / `model:success`, and
`trace:recap`. See [Get Routing Trace](../api/management.md#get-routing-trace).

## Limits

- The pool is static. A newly released model is used only after you add it to
  the registry (`routerly model add`, or `routerly model discover`) **and**
  attach it to the router.
- The profile `fallbackStrategy` is not wired to live retries; retries always
  go to the next ranked candidate, as shown above.
- Without prices, `cheapest` cannot tell models apart; set `--input-price` and
  `--output-price` (or use a model from the catalog).
