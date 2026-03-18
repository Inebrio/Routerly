# Service

The **service** is the core of Routerly. It is a Fastify-based HTTP server that acts as an intelligent proxy between your application and one or more LLM providers.

---

## What It Does

- **Drop-in API compatibility** — implements the OpenAI Chat Completions API and the Anthropic Messages API, so existing clients work without code changes
- **Intelligent routing** — uses a configurable routing engine with 9 pluggable policies to select the best model for each request
- **Cost tracking** — records every call (tokens, cost, latency) to `~/.routerly/data/usage.json`
- **Budget enforcement** — blocks requests that would exceed configured spend limits before they hit providers
- **Project isolation** — each project has its own API token, model list, and routing configuration
- **Optional dashboard** — serves the React SPA at `/dashboard/` when enabled

---

## Starting the Service

**Development (hot reload via tsx):**
```bash
npm run dev
```

**Direct execution:**
```bash
node --import tsx/esm packages/service/src/index.ts
```

**From the CLI:**
```bash
routerly start
```

The service starts on `http://localhost:3000` by default. Check the health endpoint:
```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.0.1","timestamp":"2026-01-01T00:00:00.000Z"}
```

---

## Exposed Endpoints

| Path | Purpose |
|------|---------|
| `GET /health` | Health check |
| `POST /v1/chat/completions` | OpenAI-compatible completions (requires project token) |
| `POST /v1/responses` | OpenAI Responses API (normalized to chat/completions) |
| `POST /v1/messages` | Anthropic-compatible messages (requires project token) |
| `POST /projects/:slug/v1/chat/completions` | Per-project OpenAI endpoint |
| `POST /projects/:slug/v1/messages` | Per-project Anthropic endpoint |
| `POST /api/auth/login` | Dashboard login |
| `GET /api/setup/status` | Setup status check |
| `/api/*` | Dashboard management REST API (requires dashboard session token) |
| `/dashboard/*` | React SPA (when `dashboardEnabled: true`) |

---

## Authentication

The service uses two separate authentication systems:

**Project token auth** (for LLM proxy routes `/v1/*`)
- Bearer token sent in the `Authorization` header
- Tokens are per-project and generated at project creation time
- Additional per-project tokens can be created for finer-grained access control

**Dashboard session auth** (for `/api/*` routes)
- JWT session token obtained via `POST /api/auth/login`
- Scoped to dashboard users with RBAC permissions
- Separate from project API tokens

---

## Documentation

- [Architecture](architecture.md) — how the packages fit together, request flow
- [Routing Engine](routing.md) — policies, scoring, trace system
- [Providers](providers.md) — supported providers and their configuration
- [Budgets & Limits](budgets-and-limits.md) — spend control and quota enforcement
- [API Reference](api-reference.md) — full HTTP endpoint reference with examples
