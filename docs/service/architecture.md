# Architecture

## Monorepo Structure

Routerly is organized as a four-package npm workspace:

```
routerly/
├── packages/
│   ├── shared/      # TypeScript types + AES-256 crypto utilities
│   ├── service/     # Fastify proxy server (the engine)
│   ├── cli/         # Commander.js admin CLI
│   └── dashboard/   # Vite + React management SPA
├── package.json     # Workspace root
└── tsconfig.base.json
```

Each package has its own `package.json` and `tsconfig.json`. The `shared` package is imported by all three others.

---

## Package Responsibilities

### `shared`

Contains the canonical TypeScript type definitions for the entire system:
- `ModelConfig`, `ProjectConfig`, `UserConfig`, `RoleConfig`
- `Limit`, `RoutingPolicy`, `TokenCost`, `ModelCapabilities`
- AES-256 `encrypt` / `decrypt` utilities used by the service for key storage

### `service`

The runtime core. Built with [Fastify](https://fastify.dev/):

```
packages/service/src/
├── index.ts              # Entry point, starts the server
├── server.ts             # Fastify instance, plugin registration
├── config/
│   ├── loader.ts         # Read/write JSON config files
│   └── paths.ts          # Config file paths (~/.routerly/)
├── plugins/
│   ├── auth.ts           # Project token authentication hook
│   └── jwt.ts            # Dashboard session JWT
├── routes/
│   ├── openai.ts         # POST /v1/chat/completions + /v1/responses
│   ├── anthropic.ts      # POST /v1/messages
│   └── api.ts            # Dashboard REST API (/api/*)
├── routing/
│   ├── router.ts         # Orchestrates the full routing pipeline
│   ├── selector.ts       # Combines policy scores and selects a model
│   ├── traceStore.ts     # In-memory trace storage per request
│   └── policies/         # 9 pluggable routing policy implementations
├── providers/
│   ├── index.ts          # Provider registry
│   ├── types.ts          # ProviderAdapter interface
│   ├── openai.ts         # OpenAI + Ollama + Gemini + custom adapters
│   └── anthropic.ts      # Anthropic adapter
├── cost/
│   ├── calculator.ts     # Token cost computation (with tier pricing)
│   ├── tracker.ts        # Records usage to usage.json
│   └── budget.ts         # Budget check against Limit[] rules
├── llm/
│   └── executor.ts       # LLM call execution with retry and fallback
└── notifications/
    └── sender.ts         # Alert dispatch (e.g. budget threshold notifications)
```

### `cli`

Commander.js-based admin tool. Communicates with the service over its REST API (`/api/*`).

### `dashboard`

Vite + React SPA. Built to `packages/dashboard/dist/` and served by the service at `/dashboard/`.

---

## Request Flow

The following diagram shows what happens when a client sends a request to Routerly:

```
Client Application
       │
       │  POST /v1/chat/completions
       │  Authorization: Bearer <project-token>
       ▼
┌──────────────────────────────────────────────┐
│                  Service                      │
│                                              │
│  1. Auth Plugin                              │
│     └─ Validate project token                │
│     └─ Attach project context to request     │
│                                              │
│  2. Route Handler (openai.ts)                │
│     └─ Assign trace ID                       │
│     └─ Call routeRequest()                   │
│                                              │
│  3. Router (router.ts)                       │
│     ├─ Invoke routing model with context     │
│     │    (e.g. gpt-4o-mini decides weights)  │
│     ├─ Pre-filter: remove over-budget models │
│     └─ Run 9 policies in parallel            │
│          ├─ context      → score + trace     │
│          ├─ cheapest     → score + trace     │
│          ├─ health       → score + trace     │
│          ├─ performance  → score + trace     │
│          ├─ llm          → score + trace     │
│          ├─ capability   → score + trace     │
│          ├─ rate-limit   → score + trace     │
│          ├─ fairness     → score + trace     │
│          └─ budget-remaining → score + trace │
│                                              │
│  4. Selector (selector.ts)                   │
│     └─ Combine scores with position weights  │
│     └─ Rank candidates                       │
│                                              │
│  5. Executor (executor.ts)                   │
│     ├─ Forward to winning provider           │
│     ├─ On error → try next candidate         │
│     └─ All fail → 503                        │
│                                              │
│  6. Cost Tracker                             │
│     └─ Record tokens, cost, latency          │
│                                              │
└──────────────────────────────────────────────┘
       │
       ▼
Client Application (response)
```

---

## Configuration Persistence

Routerly does not use a database. All state is stored in JSON files:

```
~/.routerly/             (overridable with ROUTERLY_HOME)
├── config/
│   ├── settings.json    # port, logLevel, dashboardEnabled
│   ├── models.json      # ModelConfig[] — API keys encrypted with AES-256
│   ├── projects.json    # ProjectConfig[] — tokens encrypted with AES-256
│   ├── users.json       # UserConfig[] — passwords stored as SHA-256 hashes
│   └── roles.json       # RoleConfig[] — custom RBAC roles
└── data/
    └── usage.json       # UsageRecord[] — full call history
```

Sensitive values (API keys, project tokens) are encrypted at rest using AES-256-CBC with the key from `ROUTERLY_SECRET_KEY`.
