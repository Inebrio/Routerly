#!/usr/bin/env bash
# Creates the "coding-agents" router for coding clients (Codex, OpenCode) with the routerly CLI.
# Requires a logged-in CLI (`routerly auth login`) and provider keys in the environment:
#   OPENAI_API_KEY and ANTHROPIC_API_KEY (required), DEEPSEEK_API_KEY (optional cheap model).
# Router tokens are written to $OUT_DIR (mode 0600), never printed.
set -euo pipefail

ROUTERLY=${ROUTERLY:-routerly}
ROUTER=${ROUTER:-coding-agents}
OUT_DIR=${OUT_DIR:-$HOME/.routerly-coding-agents}
: "${OPENAI_API_KEY:?set OPENAI_API_KEY}" "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY}"

# Roles (all provider-prefixed registry ids). Override with the matching variable if a model is renamed.
MAIN=${MAIN_MODEL:-openai/gpt-5-mini}               # balanced default and 400k context
FAST=${FAST_MODEL:-anthropic/claude-haiku-4-5}      # fast, 200k context, tool use
HEAVY=${HEAVY_MODEL:-anthropic/claude-sonnet-4-6}   # strongest and most expensive: hard tasks only
CHEAP=${CHEAP_MODEL:-deepseek/deepseek-chat}        # cheapest, 128k context: quick tasks only
EMBED=${EMBED_MODEL:-openai/text-embedding-3-small} # used by semantic-intent only, not a router candidate
BUDGET='[{"metric":"cost","windowType":"period","period":"monthly","value":50}]'
HEAVY_BUDGET='[{"metric":"cost","windowType":"period","period":"monthly","value":20}]'

$ROUTERLY model add --id "$MAIN" --provider openai --api-key "$OPENAI_API_KEY" \
  --input-price 0.25 --output-price 2 --limits-json "$BUDGET"
$ROUTERLY model add --id "$EMBED" --provider openai --api-key "$OPENAI_API_KEY" --input-price 0.02 --output-price 0
$ROUTERLY model add --id "$FAST" --provider anthropic --api-key "$ANTHROPIC_API_KEY" \
  --input-price 1 --output-price 5 --limits-json "$BUDGET"
$ROUTERLY model add --id "$HEAVY" --provider anthropic --api-key "$ANTHROPIC_API_KEY" \
  --input-price 3 --output-price 15 --limits-json "$HEAVY_BUDGET"
# `model add` has no context-window flag; the context policy needs it.
$ROUTERLY model edit "$MAIN" --context-window 400000
$ROUTERLY model edit "$FAST" --context-window 200000
$ROUTERLY model edit "$HEAVY" --context-window 1000000
models=("$MAIN" "$FAST" "$HEAVY")
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  $ROUTERLY model add --id "$CHEAP" --provider custom --endpoint https://api.deepseek.com/v1 \
    --api-key "$DEEPSEEK_API_KEY" \
    --input-price 0.28 --output-price 0.42 --limits-json "$BUDGET"
  $ROUTERLY model edit "$CHEAP" --context-window 128000
  models+=("$CHEAP")
fi

# Policy stack. Policies run in parallel; the order sets their weight (first = heaviest) and scores are averaged,
# so the order is not a model preference. Filters drop candidates, scorers rank the rest.
#   1 model-preference  scorer  a model named by the client wins (bonus 2 outweighs the other scorers);
#                               "routerly/ada" abstains and lets the policies below choose.
#   2 semantic-intent   filter  hard tasks (design, debugging, refactors) never go to the cheap 128k model;
#                               quick tasks (snippets, shell, explain) never go to the expensive HEAVY model.
#                               Unclear intent -> no filter. Applies even when the client names a model.
#   3 performance       scorer  prefers the model with the lowest recent latency (20 min window).
#   4 cheapest          scorer  breaks the remaining tie on price, so the choice is deterministic.
#   5 context           filter  drops models whose context window is smaller than the prompt (long sessions).
#   6 health, 7 rate-limit  filters  drop failing or throttled models: the survivors are the fallbacks.
# Long TTFT timeout (reasoning models).
$ROUTERLY router create --name "$ROUTER" --timeout 60000 --no-auto-routing >/dev/null
for m in "${models[@]}"; do $ROUTERLY router model add "$ROUTER" "$m"; done
INTENTS='{"hard":{"examples":["Design the architecture of a multi-service backend and explain the trade-offs","Find the root cause of this intermittent race condition across several files","Refactor this module to remove the circular dependency and keep every test passing","Plan a migration of the database schema without downtime"],"candidate_models":["'"$MAIN"'","'"$FAST"'","'"$HEAVY"'"]},"quick":{"examples":["Write a regex that matches an ISO date","What does this error message mean?","Rename this variable and fix the typo","Give me a one-line shell command to find large files"],"candidate_models":["'"$FAST"'","'"$MAIN"'"'"$( [ -n "${DEEPSEEK_API_KEY:-}" ] && printf ',"%s"' "$CHEAP" || true )"']}}'
$ROUTERLY router routing policy enable "$ROUTER" model-preference --config '{"bonus":2}'
$ROUTERLY router routing policy enable "$ROUTER" semantic-intent --config \
  '{"embedding_provider":"openai","embedding_model":"'"$EMBED"'","absolute_threshold":0.45,"ambiguity_threshold":0.04,"intents":'"$INTENTS"'}'
$ROUTERLY router routing policy enable "$ROUTER" performance
$ROUTERLY router routing policy enable "$ROUTER" cheapest
$ROUTERLY router routing policy enable "$ROUTER" context
$ROUTERLY router routing policy enable "$ROUTER" health
$ROUTERLY router routing policy enable "$ROUTER" rate-limit

umask 077
mkdir -p "$OUT_DIR"
for client in codex opencode; do
  $ROUTERLY router token create "$ROUTER" --labels "$client" --scopes coding \
    | sed -n 's/\x1b\[[0-9;]*m//g; /^sk-rt-/p' > "$OUT_DIR/$client.token"
  [ -s "$OUT_DIR/$client.token" ] || { echo "token for $client not captured" >&2; exit 1; }
done
echo "Router '$ROUTER' ready. Tokens: $OUT_DIR/{codex,opencode}.token"
