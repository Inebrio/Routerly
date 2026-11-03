---
title: Coding-agents router
sidebar_label: Coding-agents router
---

# Coding-agents router

A dedicated router for coding clients such as [Codex](./clients/codex.md) and
[OpenCode](./clients/opencode.md): four models with distinct roles, a routing
policy stack that picks between them per request, a deterministic fallback,
cost limits, and one labelled token per client so usage is measurable.
`scripts/setup-coding-agents-router.sh` builds it with the CLI only.

## Create it

Start from a running instance, log the CLI in, and export the provider keys
(they are read from the environment and never written to disk):

```bash
routerly auth login --url http://localhost:3000
export OPENAI_API_KEY=... ANTHROPIC_API_KEY=...   # DEEPSEEK_API_KEY is optional
OUT_DIR=~/.routerly-coding-agents ./scripts/setup-coding-agents-router.sh
```

The script registers these models (with explicit prices and context windows,
which the policies need) and creates the router `coding-agents` with a 60 s
time-to-first-token timeout and auto-routing off. Tokens for Codex and OpenCode
land in `$OUT_DIR/codex.token` and `$OUT_DIR/opencode.token` (mode 0600).
`router create` also issues an unlabelled default token; remove it with
`routerly router token remove coding-agents <token-id>` if unused.

| Role | Model | Price in/out per 1M | Context | Monthly cap |
| --- | --- | --- | --- | --- |
| Main | `openai/gpt-5-mini` | 0.25 / 2 | 400k | 50 USD |
| Fast | `anthropic/claude-haiku-4-5` | 1 / 5 | 200k | 50 USD |
| Heavy | `anthropic/claude-sonnet-4-6` | 3 / 15 | 1M | 20 USD |
| Cheap (optional) | `deepseek/deepseek-chat` | 0.28 / 0.42 | 128k | 50 USD |
| Embedding (not a candidate) | `openai/text-embedding-3-small` | 0.02 / 0 | n/a | none |

Override names with `ROUTER`, `MAIN_MODEL`, `FAST_MODEL`, `HEAVY_MODEL`,
`CHEAP_MODEL`, `EMBED_MODEL`.

## The routing policies

Policies run in parallel on every request. Their position sets their weight
(first is heaviest) and the scores are averaged; **the position is not a
model preference**. A policy that scores every candidate the same abstains.

| # | Policy | Role | What it does here |
| --- | --- | --- | --- |
| 1 | `model-preference` (bonus 2) | scorer | A model named by the client wins. `routerly/ada`, the model `routerly clients configure` writes, abstains and lets the others decide. |
| 2 | `semantic-intent` | filter | Classifies the last user message with embeddings. Hard tasks (design, root-cause debugging, refactors, migrations) never go to the cheap 128k model; quick tasks (snippets, shell, explaining an error) never go to the expensive heavy model. An unclear intent filters nothing. |
| 3 | `performance` | scorer | Prefers the model with the lowest recent latency (20 min window). With no data yet it abstains. |
| 4 | `cheapest` | scorer | Ranks by price, so ties are broken deterministically. |
| 5 | `context` | filter | Drops models whose context window is smaller than the prompt, so long sessions never reach the 128k model. |
| 6 | `health` | filter | Drops models that are failing. |
| 7 | `rate-limit` | filter | Drops models that are throttled. |

Filters decide who may answer; scorers decide who does. The survivors, ranked,
are the fallbacks: when the chosen model errors, the next best is tried.
Examples on a fresh instance with `routerly/ada`:

- "Give me a one-line shell command to find large files": quick intent, heavy
  model excluded, cheapest wins: `deepseek/deepseek-chat`.
- "Find the root cause of this intermittent race condition across several
  services": hard intent, cheap model excluded, cheapest of the rest:
  `openai/gpt-5-mini`.
- Same hard request with `openai/gpt-5-mini` broken: the request is served by
  `anthropic/claude-haiku-4-5`, the next best.
- A request naming `anthropic/claude-haiku-4-5`: served by it.

To see why a model was chosen, open the call under Usage in the dashboard and
read the trace (`router:policies`, `policy:result:*`, `router:recap`).

## Connect the clients

```bash
routerly clients configure codex --router coding-agents --token "$(cat ~/.routerly-coding-agents/codex.token)"
routerly clients configure opencode --router coding-agents --token "$(cat ~/.routerly-coding-agents/opencode.token)"
```

## Check it

```bash
routerly router show coding-agents
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $(cat ~/.routerly-coding-agents/codex.token)" -H 'content-type: application/json' \
  -d '{"model":"routerly/ada","messages":[{"role":"user","content":"Give me a one-line shell command to find large files"}]}'
routerly report usage --router <router-id> --json
```

To test the fallback, send a hard request, set a wrong key on the model that
served it (`routerly model edit openai/gpt-5-mini --api-key invalid`) and send
it again: it still answers 200, served by the next model. Restore the key
afterwards.
