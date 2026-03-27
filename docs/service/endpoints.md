---
title: HTTP Endpoints
sidebar_position: 2
---

# HTTP Endpoints

The service exposes three groups of HTTP endpoints on the same port (default: `3000`):

| Group | Path prefix | Auth | Purpose |
|-------|-------------|------|---------|
| [LLM Proxy](#llm-proxy) | `/v1/*` | Bearer project token (`sk-lr-…`) | Forward requests to LLM providers |
| [Management API](#management-api) | `/api/*` | Bearer JWT (dashboard session) | Configure models, projects, users |
| [Dashboard](#dashboard) | `/dashboard/*` | Browser session (cookie) | Serve the React web UI |
| [Health](#health-check) | `/health` | None | Liveness probe |

For the full request/response schemas of each route, see [API — LLM Proxy](../api/llm-proxy) and [API — Management](../api/management).

---

## LLM Proxy

These routes accept the same request bodies as the original provider APIs. Authentication is via a **project token** (`Authorization: Bearer sk-lr-…`).

Every request goes through the full routing and budget stack before being forwarded to a provider.

### `POST /v1/chat/completions`

OpenAI Chat Completions format. Supports both streaming (`"stream": true`) and non-streaming responses.

```http
POST /v1/chat/completions
Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN
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
Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN
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
Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN
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
Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN
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
