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
The `x-routerly-trace-id` header is present on blocked responses only when the
client sends `x-routerly-trace: 1` (see [Response headers](#response-headers)).

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
The block message configured on the triggering rule is **not** included in the wire
response. It is stored on the trace record only and is retrievable via
`GET /api/traces/:id`. This preserves wire-format compatibility with existing
OpenAI and Anthropic SDKs that do not expect a text body on content-filter events.
:::

When the Playground sends `x-routerly-trace: 1`, the `x-routerly-trace-id` response header can be used to look up the full trace:

```bash
curl -s http://localhost:3000/api/traces/$TRACE_ID \
  -H "Authorization: Bearer <jwt>"
```

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

| Header | Condition | Description |
|--------|-----------|-------------|
| `x-routerly-trace-id` | Only when `x-routerly-trace: 1` was sent | Trace ID for the request. Used by the Routerly Playground to fetch routing debug data via `GET /api/traces/:id`. Standard SDK clients do not receive this header. |

```
x-routerly-trace-id: 018f3c2a-4b5d-7e8f-9012-34567890abcd
```

### Request headers

| Header | Value | Description |
|--------|-------|-------------|
| `x-routerly-trace` | `1` | Opt in to receiving the `x-routerly-trace-id` response header. Used by the Routerly Playground. Standard API clients should not send this header. |
| `x-routerly-no-trace` | `1` | Suppresses `data: {"type":"trace",...}` SSE events from the streaming response wire. Trace data is still recorded server-side and accessible via `GET /api/traces/:id`. Use with strict OpenAI-compatible SDK clients that validate SSE frame schemas and reject non-standard event types. Applies to all three endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`). |
| `x-routerly-conversation-id` | string | Session identifier for grouping related requests. Appears in usage records as `sessionId` for analysis and filtering. Useful for tracking multi-turn conversations, thread IDs, or user sessions. |

### Response (streaming)

When `"stream": true`, the response is a Server-Sent Events stream. Each event has one of the following types:

| SSE data prefix | Description |
|----------------|-------------|
| `data: {"type":"trace",...}` | Routing decision metadata (first event, omitted if `x-routerly-no-trace: 1`) |
| `data: {"type":"content",...}` | Token chunk from the model |
| `data: [DONE]` | End of stream |

The `trace` event includes the selected model, policy scores, and request cost estimate.

---

## Responses API

```
POST /v1/responses
```

OpenAI Responses API compatible endpoint. Supports stateful multi-turn conversations via `previous_response_id`.

### Request headers

Same headers as [Chat Completions](#request-headers):
- `x-routerly-no-trace: 1` — suppresses trace events in streaming responses
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
- `x-routerly-no-trace: 1` — suppresses trace events in streaming responses
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

## Project-Scoped Proxy

The same endpoints are available scoped to a specific project:

```
POST /projects/{slug}/v1/chat/completions
POST /projects/{slug}/v1/responses
POST /projects/{slug}/v1/messages
```

The project slug in the URL takes precedence over the slug inferred from the Bearer token. Use this when one token has access to multiple projects.

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

Routerly extends the standard SSE stream with a `trace` event at the start:

```
data: {"type":"trace","model":"gpt-5-mini","provider":"openai","policies":["health","cheapest"],"costEstimate":0.000025}

data: {"type":"content","delta":"Hello"}

data: {"type":"content","delta":" there"}

data: [DONE]
```

Clients that only look for `data:` lines starting after the `trace` event will receive standard OpenAI delta chunks and will not need modification.
