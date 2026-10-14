---
title: Preparing a Demo Instance
sidebar_position: 7
---

# Preparing a Demo Instance

Checklist to get a Routerly instance ready to present: real models, ready-made routers, a read-only user and some traffic in Usage. Everything below uses the management API; the same can be done from the dashboard or the CLI.

## 1. Models

Add three or more real models with valid provider keys (for example `openai/gpt-4.1-nano`, `anthropic/claude-haiku-4-5`, `gemini/gemini-3.5-flash`) and set their prices, otherwise Usage shows a cost of `$0.0000`:

```bash
curl -X PUT "$URL/api/models/openai%2Fgpt-4.1-nano" \
  -H "authorization: Bearer $ADMIN_JWT" -H 'content-type: application/json' \
  -d '{"provider":"openai","inputPerMillion":0.1,"outputPerMillion":0.4}'
```

## 2. Routers

```bash
# standard router with the three models
curl -X POST "$URL/api/routers" -H "authorization: Bearer $ADMIN_JWT" -H 'content-type: application/json' \
  -d '{"name":"demo-default","models":[{"modelId":"openai/gpt-4.1-nano"},{"modelId":"anthropic/claude-haiku-4-5"},{"modelId":"gemini/gemini-3.5-flash"}]}'
# passthrough router
curl -X POST "$URL/api/routers" -H "authorization: Bearer $ADMIN_JWT" -H 'content-type: application/json' \
  -d '{"name":"demo-passthrough","kind":"passthrough","models":[]}'
```

The response of the first call contains the router token (`sk-rt-…`); it is shown only once.

## 3. Read-only user

```bash
curl -X POST "$URL/api/users" -H "authorization: Bearer $ADMIN_JWT" -H 'content-type: application/json' \
  -d '{"email":"demo@example.com","password":"<password>","roleId":"viewer","routerIds":["<demo-default id>","<demo-passthrough id>"]}'
```

## 4. Sample traffic

Send a few requests with the router token so Usage and the Overview are populated:

```bash
curl "$URL/v1/chat/completions" -H "authorization: Bearer $ROUTER_TOKEN" -H 'content-type: application/json' \
  -d '{"model":"demo","messages":[{"role":"user","content":"Say hello"}],"max_tokens":200}'
```

Reasoning models (for example Gemini) may return empty content with a very low `max_tokens`: the thinking tokens consume the budget.

## 5. Check

- Log in as admin and as the viewer; Overview, Models, Routers, Usage and Playground must load without console errors.
- Playground over plain `http://<lan-ip>` fails (`crypto.randomUUID` needs a secure context): use `ssh -L 3300:localhost:3000 <host>` and open `http://localhost:3300/dashboard`.

## 6. Full-feature demo coverage

A demo instance is only convincing when every feature has been exercised with real traffic. Use one router per feature (name them `demo-<feature>`), send real requests and check Usage:

| Area | What to create and check |
|------|--------------------------|
| Models | Real models only: at least one top-tier model per provider (for example an Opus/Sonnet-class Claude, GPT-5.x, Gemini Pro) next to the cheap ones. Remove fake or test models. |
| Profiles | Auto, Cheap, Fast, Coding and a cloned custom profile, each assigned to a router. |
| Routing policies | `cheapest`, `health`, `performance`, `capability`, `context`, `llm`, `rate-limit`, `fairness`, `budget-remaining`, `semantic-intent`, each alone and in combinations. |
| Routers | `router`, `orchestrator` (two or more candidate routers) and `passthrough` kinds. |
| Optimizers | `session-dedup`, `ccr`, `rtk`, `headroom`, `json-table`, `relevance`, `caveman`, `llmlingua-2`, each alone and combined; check the recorded savings. |
| Security | Guardrails (regex, semantic, topic, moderation, injection) and PII policies (request, response, both, streaming), alone and combined. |
| Experiments | Sticky, weighted and round-robin rotation with real traffic, then metrics. |

Finish by running the whole `docs/uat` catalog on the instance.
