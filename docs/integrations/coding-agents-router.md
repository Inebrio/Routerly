---
title: Coding-agents router
sidebar_label: Coding-agents router
---

# Coding-agents router

A dedicated router for coding clients such as [Codex](./clients/codex.md) and
[OpenCode](./clients/opencode.md): a primary model, fallback models, cost
limits, and one labelled token per client so usage is measurable.
`scripts/setup-coding-agents-router.sh` builds it with the CLI only.

## Create it

Start from a running instance, log the CLI in, and export the provider keys
(they are read from the environment and never written to disk):

```bash
routerly auth login --url http://localhost:3000
export OPENAI_API_KEY=... ANTHROPIC_API_KEY=...   # DEEPSEEK_API_KEY is optional
OUT_DIR=~/.routerly-coding-agents ./scripts/setup-coding-agents-router.sh
```

The script registers `openai/gpt-5-mini` (primary), `anthropic/claude-haiku-4-5`
(fallback) and, if `DEEPSEEK_API_KEY` is set, `deepseek/deepseek-chat`, each
with a 50 USD monthly cost limit. It creates the router `coding-agents` with a
60 s time-to-first-token timeout, auto-routing off and the policies
`model-preference`, `health`, `rate-limit`. Tokens for Codex and OpenCode land
in `$OUT_DIR/codex.token` and `$OUT_DIR/opencode.token` (mode 0600).
`router create` also issues an unlabelled default token; remove it with
`routerly router token remove coding-agents <token-id>` if unused.

Override names with `ROUTER`, `PRIMARY_MODEL`, `FALLBACK_MODEL`.

## How the primary and the fallback are chosen

The model the client requests is the primary: `model-preference` scores it
highest. If that model fails or is rate-limited, `health` and `rate-limit`
drop it and the request goes to the remaining models. Set the same model id
in the client (`openai/gpt-5-mini`). A request that names no model is spread
at random over the healthy models.

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
  -d '{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"ping"}]}'
routerly report usage --router <router-id> --json
```

To test the fallback, set a wrong key on the primary
(`routerly model edit openai/gpt-5-mini --api-key invalid`), repeat the call:
it still answers 200, served by another model. Restore the key afterwards.
