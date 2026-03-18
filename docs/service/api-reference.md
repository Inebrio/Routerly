# API Reference

The service exposes OpenAI-compatible and Anthropic-compatible endpoints, plus a management REST API for the dashboard.

All LLM proxy requests require a **project Bearer token** in the `Authorization` header.

---

## LLM Proxy Endpoints

### POST /v1/chat/completions

OpenAI Chat Completions API. Drop-in compatible with the OpenAI SDK.

**Request**

```http
POST /v1/chat/completions
Authorization: Bearer YOUR_PROJECT_TOKEN
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user",   "content": "What is the capital of France?" }
  ],
  "temperature": 0.7,
  "max_tokens": 256,
  "stream": false
}
```

**Response (non-streaming)**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1741000000,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 24,
    "completion_tokens": 9,
    "total_tokens": 33
  }
}
```

**Response headers**

| Header | Description |
|--------|-------------|
| `x-routerly-trace-id` | UUID of the routing trace for this request |

**Streaming (`"stream": true`)**

Returns SSE (`text/event-stream`). Each event is a JSON object with a `type` field:

```
data: {"type":"trace","entry":{"step":"policy:cheapest","model":"gpt-4o-mini","score":0.9}}

data: {"type":"result","candidates":[{"model":"gpt-4o","weight":0.9},{"model":"gpt-4o-mini","weight":0.4}]}

data: {"type":"content","delta":{"role":"assistant","content":"The"}}

data: {"type":"content","delta":{"content":" capital"}}

data: [DONE]
```

---

### POST /v1/responses

OpenAI Responses API. Uses `input` instead of `messages` and always streams.
Internally normalized and handled identically to `/v1/chat/completions`.

```json
{
  "model": "gpt-4o",
  "input": [
    { "role": "user", "content": "Hello!" }
  ],
  "max_output_tokens": 256
}
```

---

### POST /v1/messages

Anthropic Messages API. Compatible with the Anthropic SDK.

**Request**

```http
POST /v1/messages
Authorization: Bearer YOUR_PROJECT_TOKEN
Content-Type: application/json

{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 256,
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ]
}
```

**Response**

```json
{
  "id": "msg_abc123",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "The capital of France is Paris."
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 24,
    "output_tokens": 9
  }
}
```

---

### POST /v1/messages/count_tokens

Returns a token count estimate for an Anthropic request (without calling the model).

**Request**

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    { "role": "user", "content": "Hello there" }
  ]
}
```

**Response**

```json
{ "input_tokens": 3 }
```

---

### Per-Project Endpoints

Every project exposes its own namespaced endpoints. This allows clients to target a specific
project without the token needing to contain project information:

```
POST /projects/:slug/v1/chat/completions
POST /projects/:slug/v1/messages
```

Requests to these endpoints work identically to the global endpoints.

---

### GET /health

Health check. No authentication required.

**Response**

```json
{
  "status": "ok",
  "version": "0.0.1",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

---

## Dashboard REST API

These endpoints power the dashboard and are available for scripting. They require a **dashboard
session JWT** obtained via `POST /api/auth/login`.

### Authentication

**POST /api/auth/login**

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@example.com", "password": "your-password" }
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": "user-uuid",
    "email": "admin@example.com",
    "role": "admin",
    "permissions": ["project:read","project:write","model:read","model:write","user:read","user:write","report:read"]
  }
}
```

Include the token in subsequent requests:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

---

### Models

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `GET` | `/api/models` | `model:read` | List all models |
| `POST` | `/api/models` | `model:write` | Register a new model |
| `PUT` | `/api/models/:id` | `model:write` | Update a model |
| `DELETE` | `/api/models/:id` | `model:write` | Remove a model |

**GET /api/models: Response**

```json
[
  {
    "id": "gpt-4o",
    "name": "gpt-4o",
    "provider": "openai",
    "endpoint": "https://api.openai.com/v1",
    "cost": { "inputPerMillion": 5, "outputPerMillion": 15 },
    "capabilities": { "vision": true, "functionCalling": true, "json": true }
  }
]
```

**POST /api/models: Request**

```json
{
  "id": "gpt-4o",
  "name": "GPT-4o",
  "provider": "openai",
  "endpoint": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "cost": { "inputPerMillion": 5, "outputPerMillion": 15 },
  "capabilities": { "vision": true, "functionCalling": true, "json": true },
  "limits": [
    { "metric": "cost", "windowType": "period", "period": "monthly", "value": 200 }
  ]
}
```

---

### Projects

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `GET` | `/api/projects` | `project:read` | List all projects |
| `POST` | `/api/projects` | `project:write` | Create a project |
| `GET` | `/api/projects/:id` | `project:read` | Get project details |
| `PUT` | `/api/projects/:id` | `project:write` | Update a project |
| `DELETE` | `/api/projects/:id` | `project:write` | Delete a project |

---

### Usage

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| `GET` | `/api/usage` | `report:read` | Query usage records (supports filters) |
| `GET` | `/api/usage/summary` | `report:read` | Aggregated cost/token summary |

**GET /api/usage: Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO date | Start of date range |
| `to` | ISO date | End of date range |
| `projectId` | string | Filter by project |
| `modelId` | string | Filter by model |
| `limit` | number | Max records to return (default: 100) |

---

### Traces

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/traces/:traceId` | Retrieve all trace entries for a request |

**GET /api/traces/:traceId: Response**

```json
[
  { "step": "routing:start",    "timestamp": "...", "model": null },
  { "step": "policy:cheapest",  "timestamp": "...", "model": "gpt-4o-mini", "score": 0.95 },
  { "step": "policy:capability","timestamp": "...", "model": "gpt-4o",      "score": 0.80 },
  { "step": "selection",        "timestamp": "...", "model": "gpt-4o-mini", "reason": "highest combined score" }
]
```

---

## Error Responses

All error responses follow a consistent format:

```json
{
  "error": "Forbidden",
  "message": "Required permission: model:write"
}
```

| HTTP Status | Meaning |
|------------|---------|
| `400` | Bad request / invalid body |
| `401` | Missing or invalid token |
| `403` | Authenticated but insufficient permissions |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate model ID or project slug) |
| `503` | All candidate models failed or are over budget |
