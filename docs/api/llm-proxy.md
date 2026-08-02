---
title: LLM Proxy
sidebar_position: 2
---

# LLM Proxy API

The LLM proxy exposes standard-compatible endpoints. Any client that speaks the OpenAI or Anthropic protocol can connect without modification.

**Base URL:** `http://localhost:3000/v1`

**Authentication:** `Authorization: Bearer sk-rt-YOUR_PROJECT_TOKEN`

The proxy also accepts the Anthropic SDK's native `x-api-key: sk-rt-YOUR_PROJECT_TOKEN` header, so an Anthropic SDK client works drop-in by pointing its base URL at Routerly. `Authorization: Bearer` takes precedence when both are present.

---

## Content Guardrails and PII Scrubbing

When the project enables them, security stages run on `/v1/chat/completions`,
`/v1/responses` and `/v1/messages` before and after routing to the provider:

- **Guardrails:** message content is checked against the project's configured
  security rules (regex, semantic similarity, topic judge, moderation judge, injection
  detection). Each rule can have block and/or log actions enabled independently.
  When a rule with `block: true` triggers, the request/response is rejected and
  Routerly returns a wire-faithful response (see below). When a rule triggers with
  `log: true`, the rule name is recorded on the usage record and the request proceeds.
- **PII scrubbing:** detected entities (`EMAIL`, `PHONE`, `CREDIT_CARD`, `SSN`, `IBAN`)
  in message string content are replaced with typed placeholders before forwarding
  and/or before returning responses. Redacted entity types are recorded on the usage
  record. Each PII policy specifies whether to scrub requests, responses, or both.

Array (multimodal) message content is not inspected by either stage. See the
[management API](./management.md) for the `guardrails` and `pii` project configuration.

### Guardrail block — wire format

When a guardrail rule with `block: true` triggers, Routerly returns **HTTP 200**
and mimics the provider's native content-filter format. No HTTP error is returned.
The block is recorded on the trace like any other decision; the response itself
carries no Routerly headers (see [Response headers](#response-headers)).

**OpenAI `/v1/chat/completions` (non-streaming):**

```json
{
  "id": "chatcmpl-<trace-id>",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "" },
      "finish_reason": "content_filter"
    }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

**OpenAI `/v1/chat/completions` (streaming):**

```
data: {"id":"chatcmpl-<trace-id>","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}

data: [DONE]
```

**Anthropic `/v1/messages`:**

```json
{
  "id": "msg_<trace-id>",
  "type": "message",
  "role": "assistant",
  "content": [],
  "model": "<requested-model>",
  "stop_reason": "refusal",
  "stop_details": { "type": "refusal" },
  "usage": { "input_tokens": 0, "output_tokens": 0 }
}
```

:::note
The block message for the triggering rule (the judge's explanation, or a built-in
default) is **not** included in the wire response. It is stored on the trace record
only and is retrievable via
`GET /api/traces/:id`. This preserves wire-format compatibility with existing
OpenAI and Anthropic SDKs that do not expect a text body on content-filter events.
:::

A caller that wants to read its own trace sends its own correlation id on the
request (`x-routerly-trace: <id>`) and watches the management side channel:

```bash
curl -N "http://localhost:3000/api/traces/stream?correlationId=$MY_ID" \
  -H "Authorization: Bearer <jwt>"
```

The trace of a finished request is also on its usage record
(`GET /api/usage`, field `trace`).

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

Standard OpenAI `ChatCompletion` object. Normal API clients (using the OpenAI or
Anthropic SDKs) receive a fully standard response with no Routerly-specific headers.

### Response headers

Routerly adds none. The response is the provider's response, headers included, so
any OpenAI or Anthropic SDK works by changing the base URL and nothing else.

### Request headers

Both headers below are optional and are consumed by Routerly: neither is forwarded
to the provider, and neither changes the request or the response payload.

| Header | Value | Description |
|--------|-------|-------------|
| `x-routerly-trace` | any id you choose | Correlation id for this request. Pass the same value to `GET /api/traces/stream?correlationId=<id>` to watch the trace live on the management API. The value never leaves Routerly. |
| `x-routerly-conversation-id` | string | Session identifier for grouping related requests. Appears in usage records as `sessionId` for analysis and filtering. Useful for tracking multi-turn conversations, thread IDs, or user sessions. |

### Response (streaming)

When `"stream": true`, the response is the provider's own Server-Sent Events
stream, forwarded chunk by chunk:

| SSE data prefix | Description |
|----------------|-------------|
| `data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{...}}]}` | Token chunk from the model |
| `data: [DONE]` | End of stream |

Routerly injects no frames of its own. Routing decisions are read on the
management API (`GET /api/traces/stream`), never from the LLM wire.

---

## Responses API

```
POST /v1/responses
```

OpenAI Responses API compatible endpoint. Supports stateful multi-turn conversations via `previous_response_id`.

### Request headers

Same headers as [Chat Completions](#request-headers):
- `x-routerly-trace: <id>` — correlation id for the live trace side channel
- `x-routerly-conversation-id: <string>` — session identifier for usage tracking

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

### Request headers

Same headers as [Chat Completions](#request-headers):
- `x-routerly-trace: <id>` — correlation id for the live trace side channel
- `x-routerly-conversation-id: <string>` — session identifier for usage tracking

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

## Project Resolution

There is no project prefix in the proxy URL. The project is resolved from the Bearer token: a project token belongs to exactly one project, and that project's routing configuration, budgets and guardrails apply to the request.

To send traffic to a different project, use that project's token.

---

## Pass-Through Proxy

Any path not listed above is transparently proxied to the project's upstream provider. This covers embeddings, audio, file uploads, fine-tuning, and any endpoint the provider adds in the future.

```
ANY /<provider-path>
```

**Request:** forwarded verbatim (method, body, query string, headers) — only the `Authorization` / `x-api-key` header is replaced with the upstream API key.

**Response:** streamed back as-is, with hop-by-hop headers (`content-encoding`, `transfer-encoding`, etc.) stripped.

**Model selection:** if the request body contains a `model` field, Routerly matches it against the project's configured models. If no match, the first project model is used.

**Reserved paths** (`/`, `/health`, `/api/*`, `/dashboard*`) are never proxied.

See [Service — Pass-Through Proxy](../service/endpoints#pass-through-proxy) for the full reference.

---

## Streaming Protocol Details

The stream is the provider's stream. Routerly adds no event of its own, so an SDK
that validates SSE frames sees exactly what it would see talking to the provider
directly:

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: [DONE]
```

Which model was picked, and why, is on the trace: live on
`GET /api/traces/stream`, or afterwards on the request's usage record.

Clients that only look for `data:` lines starting after the `trace` event will receive standard OpenAI delta chunks and will not need modification.
