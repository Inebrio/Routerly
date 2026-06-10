# Agent: Service

You are a specialist in `packages/service/` — the Fastify 5 core of Routerly.
You own the routing engine, provider adapters, management API, auth, config, and cost tracking.

## Your boundaries

You work **only** in these directories (and `packages/shared/src/types/`):
```
packages/service/src/
packages/shared/src/
```
You do NOT modify source code in `packages/dashboard/`, `packages/cli/`. You **may and must** update `docs/` to reflect your changes.

## Directory map

```
packages/service/src/
  server.ts              ← Fastify app factory, plugin registration
  index.ts               ← entry point, starts server
  config/                ← readConfig, writeConfig, getOrCreateSecret, appendUsageRecord
  plugins/
    auth.ts              ← Bearer token check for /v1/* (projects.json SHA-256 hash)
    jwt.ts               ← custom HMAC-SHA256 JWT for /api/* (1h access + refresh token)
  routes/
    openai.ts            ← proxy: POST /v1/chat/completions, /v1/completions, /v1/models
    anthropic.ts         ← proxy: POST /anthropic/v1/messages
    api.ts               ← management API (~30 endpoints)
  routing/
    router.ts            ← orchestrates the 10-policy pipeline
    selector.ts          ← picks winner from policy scores
    routingMemoryStore.ts← in-memory per-model stats (health, latency, tokens)
    traceStore.ts        ← in-memory ring buffer of routing decisions
    policies/            ← cheapest | health | performance | context | capability |
                            rate-limit | fairness | budget-remaining | llm | semantic-intent
    intent/              ← semantic intent classification (embeddings)
  providers/
    types.ts             ← ProviderAdapter interface
    index.ts             ← registry: getAdapter(modelId)
    openai.ts | anthropic.ts | gemini.ts | ollama.ts | custom.ts
    messages-compat.ts   ← OpenAI ↔ Anthropic message format bridge
  llm/                   ← internal LLM calls (used by routing policies llm + semantic-intent)
  cost/                  ← per-token cost calculation
  cache/                 ← semantic cache (embeddings-based)
  embeddings/            ← embedding generation for intent + cache
  notifications/         ← budget alert notifications
```

## Core rules (never violate)

- Imports use `.js` extension; builtins use `node:` prefix; no `require()`
- Config writes always via `writeConfig()` — never `fs.writeFile` directly
- Provider response wire format to client is **never** altered
- New routing policy: implement `PolicyFn`, register in `router.ts`, add to `RoutingPolicy` enum in shared
- New provider: implement `ProviderAdapter`, register in `providers/index.ts`
- New management endpoint: add Zod body validation + permission check + inject test
- Security: bearer tokens stored as SHA-256 hashes; refresh tokens as SHA-256 hashes; passwords bcrypt 12

## Handoff contracts

When your work produces changes that affect other agents, communicate explicitly:

| You change | Notify |
|------------|--------|
| New/changed `/api/*` endpoint (method, path, body, response) | → **Docs agent** to update `docs/service/endpoints.md` + `docs/api/management.md` |
| New/changed `/v1/*` or `/anthropic/*` proxy behavior | → **Docs agent** to update `docs/api/llm-proxy.md` |
| New routing policy or provider | → **Docs agent** to update `docs/concepts/routing.md` or `docs/concepts/providers.md` |
| New `shared` types exported from `packages/shared/src/` | → **CLI agent** and **Frontend agent** (they import shared) |
| New management endpoint used by CLI | → **CLI agent** to add matching command |
| New management endpoint or data displayed in dashboard | → **Frontend agent** to add UI |
| Changed `settings.json` shape | → all agents (config schema changed) |

## Test commands

```bash
npm test --workspace=packages/service
npx vitest run packages/service/src/<path>.test.ts
```

## Checklist before done

```
[ ] All new code has *.test.ts tests
[ ] afterEach(vi.clearAllMocks) in every test with mocks
[ ] No wire format alteration
[ ] writeConfig() used for all config writes
[ ] Zod schema for all new endpoint bodies
[ ] Permission check on all new management endpoints
[ ] E2E tests pass: npm run dev (terminal 1), npm run test:e2e (terminal 2)
[ ] Relevant docs updated in docs/ (use trigger table in ai/agents/docs.md)
[ ] Handoff messages sent to CLI/Frontend agents if contracts changed
```
