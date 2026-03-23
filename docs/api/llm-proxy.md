---
title: LLM Proxy
sidebar_position: 2
---

# LLM Proxy API

The LLM proxy exposes standard-compatible endpoints. Any client that speaks the OpenAI or Anthropic protocol can connect without modification.

**Base URL:** `http://localhost:3000/v1`

**Authentication:** `Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN`

---

## Chat Completions

```
POST /v1/chat/completions
```

OpenAI-compatible chat completions endpoint. Accepts the same request body as the OpenAI API.

### Request

```json
{
  "model": "gpt-5-mini",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

The `model` field can be:
- A specific model ID registered in Routerly (e.g. `gpt-5-mini`)
- Any value — Routerly will use its routing policies to pick the best model regardless

### Response (non-streaming)

Standard OpenAI `ChatCompletion` object, with an additional header:

```
x-routerly-trace-id: 018f3c2a-4b5d-7e8f-9012-34567890abcd
```

### Response (streaming)

When `"stream": true`, the response is a Server-Sent Events stream. Each event has one of the following types:

| SSE data prefix | Description |
|----------------|-------------|
| `data: {"type":"trace",...}` | Routing decision metadata (first event) |
| `data: {"type":"content",...}` | Token chunk from the model |
| `data: [DONE]` | End of stream |

The `trace` event includes the selected model, policy scores, and request cost estimate.

---

## Responses API

```
POST /v1/responses
```

OpenAI Responses API compatible endpoint. Supports stateful multi-turn conversations via `previous_response_id`.

### Request

```json
{
  "model": "gpt-5-mini",
  "input": "Tell me a joke.",
  "stream": false
}
```

### Response

Standard OpenAI `Response` object structure.

---

## Anthropic Messages

```
POST /v1/messages
```

Anthropic Messages API compatible endpoint. Use this with the Anthropic SDK by setting `base_url` to `http://localhost:3000`.

### Request

```json
{
  "model": "claude-haiku-4-5",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

### Response

Standard Anthropic `Message` object.

---

## Count Tokens

```
POST /v1/messages/count_tokens
```

Anthropic-compatible token counting endpoint. Returns the number of input tokens for a given message set without making an inference call.

### Request

```json
{
  "model": "claude-haiku-4-5",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

### Response

```json
{ "input_tokens": 10 }
```

---

## Project-Scoped Proxy

The same endpoints are available scoped to a specific project:

```
POST /projects/{slug}/v1/chat/completions
POST /projects/{slug}/v1/responses
POST /projects/{slug}/v1/messages
```

The project slug in the URL takes precedence over the slug inferred from the Bearer token. Use this when one token has access to multiple projects.

---

## Streaming Protocol Details

Routerly extends the standard SSE stream with a `trace` event at the start:

```
data: {"type":"trace","model":"gpt-5-mini","provider":"openai","policies":["health","cheapest"],"costEstimate":0.000025}

data: {"type":"content","delta":"Hello"}

data: {"type":"content","delta":" there"}

data: [DONE]
```

Clients that only look for `data:` lines starting after the `trace` event will receive standard OpenAI delta chunks and will not need modification.
