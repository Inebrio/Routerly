---
title: Providers
sidebar_position: 2
---

# Providers

A **provider** is an LLM platform that Routerly knows how to communicate with. Each provider has its own wire protocol, authentication scheme, and model catalogue.

---

## Supported Providers

| Provider | ID | Authentication | Notes |
|----------|----|----------------|-------|
| OpenAI | `openai` | API key | Chat completions + Responses API + token counting |
| Anthropic | `anthropic` | API key | Messages API + token counting |
| Google Gemini | `gemini` | API key | OpenAI-compatible endpoint |
| Mistral | `mistral` | API key | OpenAI-compatible endpoint |
| Cohere | `cohere` | API key | OpenAI-compatible endpoint |
| xAI (Grok) | `xai` | API key | OpenAI-compatible endpoint |
| Ollama | `ollama` | None | Local inference; set `baseUrl` to your Ollama host |
| Custom | `custom` | Optional | Any OpenAI-compatible endpoint |

---

## OpenAI

| Model ID | Context | Input price | Output price | Capabilities |
|----------|---------|-------------|--------------|--------------|
| `gpt-5.2` | 128k | $1.75 / 1M | $14 / 1M | Vision, function calling, JSON |
| `gpt-5.1` | 128k | $1.25 / 1M | $10 / 1M | Vision, function calling, JSON |
| `gpt-5` | 128k | $1.25 / 1M | $10 / 1M | Vision, function calling, JSON |
| `gpt-5-mini` | 128k | $0.25 / 1M | $2 / 1M | Vision, function calling, JSON |
| `gpt-5-nano` | 128k | $0.05 / 1M | $0.4 / 1M | Function calling, JSON |
| `gpt-4.1` | 1M | $2 / 1M | $8 / 1M | Vision, function calling, JSON |
| `gpt-4.1-mini` | 1M | $0.40 / 1M | $1.6 / 1M | Vision, function calling, JSON |
| `gpt-4.1-nano` | 1M | $0.10 / 1M | $0.4 / 1M | Function calling, JSON |
| `gpt-4o` | 128k | $2.50 / 1M | $10 / 1M | Vision, function calling, JSON |
| `gpt-4o-mini` | 128k | $0.15 / 1M | $0.6 / 1M | Vision, function calling, JSON |
| `o1` | 200k | $15 / 1M | $60 / 1M | Thinking, function calling, JSON |
| `o3` | 200k | $2 / 1M | $8 / 1M | Thinking, function calling, JSON |
| `o4-mini` | 200k | $1.10 / 1M | $4.4 / 1M | Thinking, function calling, JSON |

Prices are per 1 million tokens unless otherwise noted.

---

## Anthropic

| Model ID | Context | Input price | Output price | Notes |
|----------|---------|-------------|--------------|-------|
| `claude-opus-4-6` | 200k | $5 / 1M | $25 / 1M | Tier >200k tokens: $10 / $37.5 |
| `claude-sonnet-4-6` | 200k | $3 / 1M | $15 / 1M | |
| `claude-sonnet-4-5` | 200k | $3 / 1M | $15 / 1M | Tier >200k tokens: $6 / $22.5 |
| `claude-haiku-4-5` | 200k | $1 / 1M | $5 / 1M | |
| `claude-opus-4-1` | 200k | $15 / 1M | $75 / 1M | Vision, function calling, JSON |
| `claude-sonnet-4-1` | 200k | $3 / 1M | $15 / 1M | Vision, function calling, JSON |

---

## Google Gemini

| Model ID | Context | Input price | Output price | Notes |
|----------|---------|-------------|--------------|-------|
| `gemini-2.5-pro` | 2M | $1.25 / 1M | $10 / 1M | Tier >200k: $2.5 / $15 |
| `gemini-2.5-flash` | 1M | $0.30 / 1M | $2.5 / 1M | |
| `gemini-2.5-flash-lite` | 1M | $0.10 / 1M | $0.4 / 1M | |
| `gemini-3.1-pro-preview` | 2M | $2 / 1M | $12 / 1M | Tier >200k: higher |
| `gemini-3-pro-preview` | 2M | — | — | Experimental |
| `gemini-3-flash-preview` | 1M | — | — | Experimental |
| `gemini-2.0-flash` | 1M | $0.10 / 1M | $0.4 / 1M | |
| `gemini-2.0-flash-lite` | 1M | $0.075 / 1M | $0.3 / 1M | |

---

## Mistral

| Model ID | Notes |
|----------|-------|
| `mistral-large-latest` | Flagship model |
| `mistral-small-latest` | Efficient, low cost |
| `mistral-nemo` | Open-weight, 12B |
| `codestral-latest` | Code specialised |
| `ministral-8b-latest` | Ultra-small |

---

## Cohere

| Model ID | Notes |
|----------|-------|
| `command-r-plus` | Best quality |
| `command-r` | Balanced |
| `command-a-03-2025` | Latest generation |
| `command-nightly` | Bleeding edge |
| `c4ai-aya-expanse-8b` | Multilingual, 8B |
| `c4ai-aya-expanse-32b` | Multilingual, 32B |
| `embed-english-v3.0` | Embeddings |

---

## xAI (Grok)

| Model ID | Notes |
|----------|-------|
| `grok-3` | Latest flagship |
| `grok-3-fast` | Optimised for speed |
| `grok-3-mini` | Efficient |
| `grok-3-mini-fast` | Smallest / fastest |

---

## Ollama (Local)

| Model ID | Notes |
|----------|-------|
| `ollama/llama3.2` | Meta Llama 3.2, 3B |
| `ollama/llama3.1:8b` | Meta Llama 3.1, 8B |
| `ollama/qwen3:4b` | Qwen3, 4B |
| `ollama/qwen3:8b` | Qwen3, 8B |
| `ollama/mistral` | Mistral 7B |
| `ollama/phi4-mini` | Microsoft Phi-4 Mini |
| `ollama/gemma3:4b` | Google Gemma 3, 4B |
| `ollama/deepseek-r1:7b` | DeepSeek R1, 7B |

Ollama models require a running Ollama server. The default base URL is `http://localhost:11434`. Override it per-model in the dashboard with the **Base URL** field.

---

## Custom / Self-hosted

Use provider ID `custom` for any OpenAI-compatible endpoint (vLLM, LM Studio, LocalAI, etc.):

```bash
routerly model add \
  --id my-custom-model \
  --provider custom \
  --base-url http://192.168.1.50:8000/v1 \
  --input-price 0 \
  --output-price 0
```

---

## Adding a Provider Model

All models must be registered in Routerly before they can be used. See [Concepts: Models](./models.md) for registration details.
