---
title: Providers
sidebar_position: 2
---

# Providers

A **provider** is an LLM platform that Routerly knows how to communicate with. Each provider has its own wire protocol, authentication scheme, and model catalogue.

---

## Provider Catalog

Routerly fetches its provider and model catalog dynamically at runtime from one or more remote repositories instead of relying on hardcoded definitions. This enables rapid updates to supported models and providers without service restarts.

### Default Catalog Source

By default, Routerly fetches the catalog from the official Inebrio repository:

```
https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/
```

### How Resolution Works

When fetching the catalog, Routerly applies the following resolution order:

1. **Channel override** — if configured for a repo, use the named channel (e.g. `stable`, `latest`)
2. **Semver range match** — select the catalog version matching your Routerly version (e.g. `^0.3.0`)
3. **Default channel fallback** — if no semver match, use the repo's default channel
4. **Direct fallback** — if all else fails, load `providers.json` directly from the repo root

Each catalog file is timestamped as an immutable snapshot (format: `providers/providers.YYYYMMDDHHMMSS.json`) and verified with SHA-256 checksums after download.

### Caching and Refresh

The catalog is cached in memory for 6 hours after the first fetch. All repositories are fetched together in a single batch. To force an immediate refresh, use:

```bash
routerly catalog refresh
```

Or via the dashboard: **Settings > Provider Catalog > Refresh Cache** button.

### Multiple Repositories

You can add multiple custom repositories alongside the default one. Repositories are processed in reverse order (last added = first checked), so the first repo in your list wins on merge conflict.

Add a custom repo:

```bash
routerly catalog repos add https://your-org.com/catalog/
```

See [CLI: routerly catalog](../cli/commands.md#routerly-catalog) for full repository management commands, or use the dashboard **Settings > Provider Catalog** tab.

### Per-Repository Status

Each configured repository tracks:
- **Resolved File** — the filename of the catalog last successfully fetched (e.g. `providers.20260630120000.json`)
- **Updated At** — timestamp from the catalog registry (when the snapshot was created)
- **Last Checked** — when Routerly last attempted to fetch from this repo
- **Status** — Active (green), Disabled (muted), or Error (red with details)

### Catalog-Tracked Model Fields

When you add a model from the catalog, Routerly tracks which fields (input price, output price, context window, capabilities, etc.) came from the catalog. Catalog-tracked fields automatically sync with the provider's catalog every 6 hours — or immediately when you manually refresh the catalog via **Settings > Provider Catalog > Refresh Cache** or `routerly catalog refresh`.

**Auto-sync fields:**
- Input price per 1M tokens
- Output price per 1M tokens
- Cache read price per 1M tokens (if applicable)
- Cache write price per 1M tokens (if applicable)
- Pricing tiers (e.g., Anthropic's >200k token tier)
- Context window
- Capabilities (vision, function calling, JSON, etc.)

If you manually edit any of these fields, Routerly stops auto-syncing that specific field — it becomes **locked** at your custom value. You can unlock a field by resetting it back to the catalog default. See the dashboard and CLI docs for field-reset instructions.

Models not found in any catalog (local Ollama instances, custom endpoints) do not have catalog tracking — they remain fully manual.

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
