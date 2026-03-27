---
title: Provider Adapters
sidebar_position: 4
---

# Provider Adapters

Each LLM provider has a different HTTP API, authentication scheme, and wire format. Routerly bridges those differences through **provider adapters** — thin classes that translate a normalised internal request into the provider's specific format and translate the response back.

Adapters are selected automatically based on the `provider` field in a model's configuration.

---

## Adapter Overview

| Provider ID | Class | Protocol | Notes |
|-------------|-------|----------|-------|
| `openai` | `OpenAIAdapter` | OpenAI Chat Completions | Native SDK; also handles `/v1/responses` |
| `anthropic` | `AnthropicAdapter` | Anthropic Messages API | Full message conversion, prompt caching |
| `gemini` | `GeminiAdapter` | OpenAI-compatible endpoint | Uses OpenAI SDK pointed at Google's OpenAI-compatible base URL |
| `ollama` | `OllamaAdapter` | OpenAI-compatible endpoint | Uses OpenAI SDK pointed at local Ollama host |
| `custom` | `CustomAdapter` | OpenAI-compatible endpoint | Any endpoint that speaks `/v1/chat/completions` |

---

## OpenAI Adapter

Uses the official `openai` Node.js SDK.

**Model ID resolution** — If the registered model ID contains a slash (e.g. `openai/gpt-4o`), the adapter strips the prefix and sends only the part after the slash (`gpt-4o`) to the provider. This lets you namespace model IDs within Routerly without confusing OpenAI.

**Endpoint override** — If `endpoint` is set in the model config, the adapter uses it instead of `https://api.openai.com/v1`. This lets you point to Azure OpenAI, local OpenAI proxies, or compatible services.

**Streaming** — Uses the SDK's native async iterator. Chunks are forwarded to the client as Server-Sent Events (SSE) as they arrive.

```json
// Example model config
{
  "id": "gpt-5-mini",
  "provider": "openai",
  "apiKey": "<encrypted>",
  "endpoint": null
}
```

---

## Anthropic Adapter

Uses the official `@anthropic-ai/sdk` Node.js SDK.

**Message format conversion** — The Anthropic Messages API differs from OpenAI's Chat Completions format in several ways. The adapter handles all conversions automatically:

| OpenAI format | Anthropic format |
|---------------|-----------------|
| `messages[].role = "tool"` | Converted to `role: "user"` with a `tool_result` content block |
| `messages[].role = "assistant"` with `tool_calls` | Content blocks of type `tool_use` |
| Consecutive tool result messages | Merged into a single `user` message (Anthropic requirement) |
| `content` as an array of content parts | Mapped block-by-block, preserving `cache_control` fields |
| `system` message in `messages[]` | Extracted and passed as Anthropic's top-level `system` field |
| `image_url` content parts (data URI) | Converted to Anthropic base64 image blocks |
| `image_url` content parts (URL) | Converted to Anthropic URL image source |

**Prompt caching** — The adapter preserves any `cache_control` fields present in message content parts, enabling Anthropic's prompt caching feature to work end-to-end.

**Streaming** — Uses the SDK's streaming API. SSE chunks are translated back to OpenAI-compatible format for `/v1/chat/completions` requests, or forwarded as-is for `/v1/messages` requests.

```json
// Example model config
{
  "id": "claude-haiku-4-5",
  "provider": "anthropic",
  "apiKey": "<encrypted>",
  "endpoint": null
}
```

---

## Gemini Adapter

Uses the `openai` SDK pointed at Google's OpenAI-compatible base URL (`https://generativelanguage.googleapis.com/v1beta/openai`). No format conversion is needed — Gemini's compatibility layer handles it.

```json
// Example model config
{
  "id": "gemini-2.5-flash",
  "provider": "gemini",
  "apiKey": "<encrypted>"
}
```

---

## Ollama Adapter

Uses the `openai` SDK pointed at the Ollama host. No API key is required (Ollama has no auth by default).

Set the `baseUrl` field in the model config to your Ollama host:

```json
// Example model config
{
  "id": "llama3",
  "provider": "ollama",
  "endpoint": "http://localhost:11434/v1",
  "apiKey": null
}
```

If you run Ollama on a different machine, change the `endpoint` to match. Routerly treats Ollama models as zero-cost (`inputPerMillion: 0, outputPerMillion: 0`) by default unless you configure explicit pricing.

---

## Custom Adapter

For any provider that exposes an OpenAI-compatible `/v1/chat/completions` endpoint. Uses the `openai` SDK with a custom `baseURL`.

**Required field:** `endpoint` must be set to the provider's base URL.

```json
// Example model config
{
  "id": "my-local-llm",
  "provider": "custom",
  "endpoint": "http://192.168.1.50:8080/v1",
  "apiKey": "optional-key-if-required"
}
```

This adapter works with LM Studio, llama.cpp server, vLLM, LocalAI, and any other service that implements the OpenAI `/v1/chat/completions` interface.

---

## Mistral, Cohere, xAI

These providers use the OpenAI-compatible protocol. Register them using the `custom` adapter with the appropriate `endpoint` and `apiKey`:

| Provider | Endpoint |
|----------|----------|
| Mistral | `https://api.mistral.ai/v1` |
| Cohere | `https://api.cohere.com/compatibility/v1` |
| xAI (Grok) | `https://api.x.ai/v1` |

```json
// Example: Mistral
{
  "id": "mistral-large",
  "provider": "custom",
  "endpoint": "https://api.mistral.ai/v1",
  "apiKey": "<encrypted>"
}
```

---

## Timeout Handling

Each adapter respects the `timeout` field in the model config (in milliseconds). If not set, it falls back to the service-wide `defaultTimeoutMs` setting (`30000` ms). Timed-out requests are recorded as `outcome: "timeout"` in usage records and the `health` policy will penalise the model accordingly.

---

## Related

- [Concepts — Providers](../concepts/providers) — provider catalogue with model lists and pricing
- [Service — Routing Engine](./routing-engine) — how adapters are invoked after model selection
- [Dashboard — Models](../dashboard/models) — how to register a model with a provider
