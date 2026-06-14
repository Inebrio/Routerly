---
title: HTTP Endpoints
sidebar_position: 2
---

# HTTP Endpoints

The service exposes four groups of HTTP endpoints on the same port (default: `3000`):

| Group | Path prefix | Auth | Purpose |
|-------|-------------|------|---------|
| [LLM Proxy](#llm-proxy) | `/v1/*` | Bearer project token (`sk-rt-…`) | Forward requests to LLM providers |
| [Pass-Through Proxy](#pass-through-proxy) | any other path | Bearer project token (`sk-rt-…`) | Transparently forward any unhandled provider endpoint |
| [Management API](#management-api) | `/api/*` | Bearer JWT (dashboard session) | Configure models, projects, users |
| [Dashboard](#dashboard) | `/dashboard/*` | Browser session (cookie) | Serve the React web UI |
| [Health](#health-check) | `/health` | None | Liveness probe |

For the full request/response schemas of each route, see [API — LLM Proxy](../api/llm-proxy) and [API — Management](../api/management).

---

## LLM Proxy

These routes accept the same request bodies as the original provider APIs. Authentication is via a **project token** (`Authorization: Bearer sk-rt-…`).

Every request goes through the full routing and budget stack before being forwarded to a provider.

### `POST /v1/chat/completions`

OpenAI Chat Completions format. Supports both streaming (`"stream": true`) and non-streaming responses.

```http
POST /v1/chat/completions
Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN
Content-Type: application/json

{
  "model": "gpt-5-mini",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": false
}
```

The `model` field is the model ID registered in your project. Routerly ignores it as an upstream model directive — the routing engine picks the actual provider model based on your policies.

### `POST /v1/responses`

OpenAI Responses API format (newer API surface). Uses `input` instead of `messages` and always streams. Routerly normalises it to the `chat/completions` shape internally before routing.

```http
POST /v1/responses
Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN
Content-Type: application/json

{
  "model": "gpt-5-mini",
  "input": [{ "role": "user", "content": "Hello!" }]
}
```

### `POST /v1/messages`

Anthropic Messages API format. The request body matches the Anthropic SDK wire format exactly.

```http
POST /v1/messages
Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN
Content-Type: application/json

{
  "model": "claude-haiku-4-5",
  "max_tokens": 1024,
  "messages": [{ "role": "user", "content": "Hello!" }]
}
```

Routerly proxies this to the Anthropic provider adapter. If the selected model is an OpenAI model, the adapter translates the request format automatically.

### `GET /v1/models`

Returns the list of models available in the project associated with the token, in the OpenAI `GET /v1/models` response format.

```http
GET /v1/models
Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN
```

### Error format

All LLM Proxy errors follow the OpenAI error envelope:

```json
{
  "error": {
    "message": "Budget exceeded for model gpt-5-mini",
    "type": "budget_exceeded",
    "code": "budget_exceeded"
  }
}
```

Common status codes:

| Code | Cause |
|------|-------|
| `401` | Missing or invalid project token |
| `503` | No model passed all routing filters (all excluded or over budget) |
| `503` | Budget exhausted for the project or token |
| `504` | Provider timeout |

---

## Pass-Through Proxy

Any path that Routerly does not explicitly handle is transparently forwarded to the project's upstream provider. Only the API key is swapped — method, headers, body, and query string are passed through verbatim. This makes Routerly a true drop-in replacement for the full provider API surface, not just chat completions.

**Authentication:** same `Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN` header required for the LLM Proxy.

### What it enables

| Provider | Endpoints now available via Routerly |
|----------|--------------------------------------|
| OpenAI | `/v1/embeddings`, `/v1/audio/transcriptions`, `/v1/audio/speech`, `/v1/files`, `/v1/fine-tuning/*`, and any future endpoints |
| Anthropic | `/v1/complete`, `/v1/messages/batches`, `/v1/models`, and any future endpoints |
| Ollama | `/api/embeddings`, `/api/tags`, `/api/pull`, and more |
| Custom providers | Any path your upstream accepts |

### Model selection

When the request body contains a `model` field, Routerly matches it against the project's configured models (by ID or upstream model ID) and uses the corresponding provider credentials. If no match is found, or the request has no body, it falls back to the first configured model in the project.

### Reserved namespaces

The following paths are **never** proxied and always return a Routerly-native response:

| Path | Behaviour |
|------|-----------|
| `/` | Redirect to `/dashboard/` |
| `/health` | Health check response |
| `/api/*` | Management API |
| `/dashboard*` | Dashboard static files |

Any request to these paths with a project token receives a standard 404, not a proxy attempt.

### Example: embeddings

```http
POST /v1/embeddings
Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN
Content-Type: application/json

{
  "model": "text-embedding-3-small",
  "input": "The quick brown fox"
}
```

Routerly finds the configured model matching `text-embedding-3-small`, injects the upstream API key, and forwards the request to `https://api.openai.com/v1/embeddings`. The response is streamed back as-is.

### Error codes

| Code | Cause |
|------|-------|
| `401` | Missing or invalid project token |
| `502 no_upstream` | Project has no configured models |
| `502 upstream_error` | Network error reaching the upstream provider |

---

## Management API

The Management API is used by the dashboard and the CLI. Authentication is via a **JWT** obtained from `POST /api/auth/login`.

Full endpoint catalogue: [API — Management](../api/management).

### Key routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Obtain a JWT |
| `GET` | `/api/models` | List registered models |
| `POST` | `/api/models` | Register a new model |
| `PUT` | `/api/models/:id` | Update a model |
| `DELETE` | `/api/models/:id` | Remove a model |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/usage` | Query usage records |
| `GET` | `/api/settings` | Read service settings |
| `PUT` | `/api/settings` | Update service settings |
| `GET` | `/api/users` | List users (admin only) |

---

## Dashboard

When `dashboardEnabled: true` (default), the service bundles and serves the React web UI as static files.

| Path | Behaviour |
|------|-----------|
| `GET /dashboard/` | Serves `index.html` (React app entry point) |
| `GET /dashboard/*` | Static assets (JS, CSS, icons) — falls back to `index.html` for client-side routes |
| `GET /dashboard` | Redirects to `/dashboard/` |
| `GET /` | Redirects to `/dashboard/` |

To disable the dashboard (e.g. in a headless production deployment):

```json
// settings.json
{ "dashboardEnabled": false }
```

---

## Health Check

```http
GET /health
```

No authentication required. Returns HTTP 200 with a JSON body:

```json
{
  "status": "ok",
  "version": "0.1.5",
  "timestamp": "2026-03-27T12:00:00.000Z"
}
```

Suitable for Docker `HEALTHCHECK`, Kubernetes liveness probes, and load balancer checks.

---

## Trace Header

Every LLM Proxy response includes an `x-routerly-trace-id` header containing a UUID that identifies the routing trace for that request. You can use this ID to look up the routing decision in the dashboard's Playground trace viewer.

```http
x-routerly-trace-id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
```

---

## Related

- [API — LLM Proxy](../api/llm-proxy) — full request/response schemas
- [API — Management](../api/management) — full management endpoint catalogue
- [Service — Routing Engine](./routing-engine) — how the model is selected for each request
