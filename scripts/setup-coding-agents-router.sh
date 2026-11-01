#!/usr/bin/env bash
# Creates the "coding-agents" router for coding clients (Codex, OpenCode) with the routerly CLI.
# Requires a logged-in CLI (`routerly auth login`) and provider keys in the environment:
#   OPENAI_API_KEY (primary), ANTHROPIC_API_KEY (fallback), DEEPSEEK_API_KEY (optional third).
# Router tokens are written to $OUT_DIR (mode 0600), never printed.
set -euo pipefail

ROUTERLY=${ROUTERLY:-routerly}
ROUTER=${ROUTER:-coding-agents}
OUT_DIR=${OUT_DIR:-$HOME/.routerly-coding-agents}
: "${OPENAI_API_KEY:?set OPENAI_API_KEY}" "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY}"

PRIMARY=${PRIMARY_MODEL:-openai/gpt-5-mini}
FALLBACK=${FALLBACK_MODEL:-anthropic/claude-haiku-4-5}
BUDGET='[{"metric":"cost","windowType":"period","period":"monthly","value":50}]'

models=("$PRIMARY" "$FALLBACK")
$ROUTERLY model add --id "$PRIMARY" --provider openai --api-key "$OPENAI_API_KEY" --limits-json "$BUDGET"
$ROUTERLY model add --id "$FALLBACK" --provider anthropic --api-key "$ANTHROPIC_API_KEY" --limits-json "$BUDGET"
if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  $ROUTERLY model add --id deepseek/deepseek-chat --provider custom --endpoint https://api.deepseek.com/v1 \
    --api-key "$DEEPSEEK_API_KEY" --limits-json "$BUDGET"
  models+=(deepseek/deepseek-chat)
fi

# Long TTFT timeout (reasoning models). The model named by the client (codex/opencode `model` setting) is the
# primary via model-preference; health + rate-limit drop failing models, so the others act as fallback.
# A request that names no model is spread randomly over the healthy ones (equal scores tie at random).
$ROUTERLY router create --name "$ROUTER" --timeout 60000 --no-auto-routing >/dev/null
for m in "${models[@]}"; do $ROUTERLY router model add "$ROUTER" "$m"; done
$ROUTERLY router routing policy enable "$ROUTER" model-preference
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
