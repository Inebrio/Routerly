# Architecture

## Request flow — LLM proxy

A request to `POST /v1/chat/completions` follows these steps:

1. **Fastify receives the request** — CORS and rate-limit hooks run first
2. **Auth plugin** — extracts the `Authorization: Bearer <token>` header, looks it up in `projects.json`, attaches `request.project` (or returns 401)
3. **OpenAI route handler** — validates body with Zod schema
4. **Router** — `router.ts` receives the request + project config and runs the policy pipeline
5. **Policy pipeline** — each of the 10 policies scores the available model candidates; scores are summed per model; the highest-ranked model wins
6. **Fallback loop** — if the winning model fails, the executor tries the next candidate down the ranked list
7. **Executor** (`llm/executor.ts`) — calls the appropriate `ProviderAdapter` based on `model.provider`
8. **Provider adapter** — translates the request to the provider's wire format, calls the external API, and returns the response (streaming or non-streaming)
9. **Response** — the executor streams or returns the provider response verbatim; trace headers (`x-routerly-trace-id`, `x-routerly-model`) are added; usage is appended to `data/usage.json`

For `POST /v1/messages` (Anthropic), steps 3–9 are analogous but the Anthropic route handler is used.

---

## Server bootstrap lifecycle

`packages/service/src/index.ts` registers plugins and routes in this order:

```
CORS (@fastify/cors)
Static files (@fastify/static → packages/dashboard/dist/)
API routes plugin → /api/* (management)
  └─ auth middleware (JWT HMAC-SHA256)
OpenAI proxy routes → /v1/chat/completions, /v1/responses, /v1/models
Anthropic proxy routes → /v1/messages
Root redirect → / → /dashboard/
Health endpoint → GET /health
```

---

## Routing engine

**File**: `packages/service/src/routing/router.ts`

The `RouteRequest` function receives:
- `request` — the incoming LLM request (model hint, messages, etc.)
- `candidates` — array of configured models for the project
- `projectConfig` — routing policies enabled for the project

It returns a ranked `RoutingResult[]` sorted by score descending.

### 10 routing policies

| Policy | Description |
|--------|-------------|
| `cheapest` | score based on token price (input + output) |
| `health` | penalizes models with recent errors (tracked in `RoutingMemoryStore`) |
| `performance` | scores based on measured latency (tracked in `RoutingMemoryStore`) |
| `context` | scores based on context window match vs input token count |
| `capability` | scores based on declared capabilities (vision, tools, etc.) |
| `rate-limit` | penalizes models approaching their configured RPM/TPM limits |
| `fairness` | distributes load evenly across models with similar scores |
| `budget-remaining` | excludes models whose project budget is exhausted |
| `llm` | uses a meta-LLM to select the best model (experimental) |
| `semantic-intent` | matches models to request intent via embeddings |

Each policy is a `PolicyFn`:
```ts
type PolicyFn = (ctx: PolicyContext) => PolicyResult
// PolicyContext: { request, candidates, projectConfig, memoryStore, ... }
// PolicyResult:  { routing: Array<{ model: ModelConfig, points: number }>, excludes?: string[] }
```

### `llm` policy — internal scoring format

The `llm` policy calls a configured meta-LLM **internally** and parses its response. The expected JSON format (produced by the meta-LLM) is:

```json
{
  "routing": [
    { "model": "<model-id>", "point": 0.9 },
    { "model": "<model-id>", "point": 0.7 }
  ]
}
```

`point` is a float 0.0–1.0. This is an **internal** format between the policy and the meta-LLM; it is not exposed to clients. Truncated JSON is recovered via regex; a repair call is attempted if parsing fails entirely.

### Budget enforcement

Budget is enforced in **two separate stages**:

1. **Pre-filter** (in `router.ts`, before any policy runs): `isAllowed()` checks all configured limits (global + project). Models that have already exceeded any limit are **hard-excluded** from the candidate pool.
2. **`budget-remaining` policy** (soft scoring): for the surviving candidates, scores each model by headroom (`(limit - current) / limit`). Takes the minimum headroom across all limits (bottleneck). Models with more headroom score higher (0.0–1.0).

---

## Provider adapters

**Directory**: `packages/service/src/providers/`

Every provider file exports a factory function that returns a `ProviderAdapter`:

```ts
interface ProviderAdapter {
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>
  streamCompletion(req: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>
  messages?(req: AnthropicMessagesRequest): Promise<AnthropicMessagesResponse>  // Anthropic only
}
```

| File | Provider |
|------|---------|
| `openai.ts` | OpenAI (`openai` SDK ^4) |
| `anthropic.ts` | Anthropic (`@anthropic-ai/sdk` ^0.39) |
| `gemini.ts` | Google Gemini (OpenAI-compatible endpoint) |
| `ollama.ts` | Ollama (local OpenAI-compatible endpoint) |
| `custom.ts` | Any OpenAI-compatible endpoint |

---

## In-memory stores

These stores live in process memory and are reset on restart. They are used by routing policies only.

| Store | TTL | Max entries | Purpose |
|-------|-----|-------------|---------|
| `TraceStore` | 5 min | unbounded | stores recent traces for health/performance stats |
| `RoutingMemoryStore` | 1 h | 50 per model | smoothed error rate and latency per model |

---

## Management API auth flow

Requests to `/api/*` (except `POST /api/auth/login`) go through the JWT plugin:

1. Extract `Authorization: Bearer <jwt>` header
2. Split into `payload` (base64url) and `signature`
3. Verify `HMAC-SHA256(base64url(payload), secret) === signature`
4. Check `exp` claim — return 401 if expired
5. Look up user in `users.json`, attach `request.dashUser`

Login endpoint (`POST /api/auth/login`):
1. Load user by username from `users.json`
2. If password hash is legacy SHA-256: migrate to bcrypt 12 rounds, save, proceed
3. `bcrypt.compare(password, hash)` — return 401 on mismatch
4. Issue JWT (1 h expiry) + refresh token (random 40-byte hex, stored as SHA-256 hash)
