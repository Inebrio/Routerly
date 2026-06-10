---
title: Models
sidebar_position: 3
---

# Models

A **model** in Routerly is a registered entry that maps a model identifier to a provider, its API credentials, pricing, and capabilities. You register each model once, and it becomes available to all projects.

---

## Registering a Model

### CLI

```bash
routerly model add \
  --id gpt-5-mini \
  --provider openai \
  --api-key sk-YOUR_KEY
```

For well-known model IDs, pricing and capabilities are pre-filled from built-in presets. You can override them with additional flags.

```bash
routerly model add \
  --id my-fine-tune \
  --provider openai \
  --api-key sk-YOUR_KEY \
  --input-price 0.5 \
  --output-price 2.0 \
  --context-window 128000
```

Use `routerly model list` to see all registered models and `routerly model remove --id <id>` to delete one.

### Dashboard

1. Open **Models** in the sidebar
2. Click **+ New Model**
3. Fill in: **Model ID**, **Provider**, **API Key**
4. Pricing fields are pre-filled for known models — adjust if needed
5. Set **Capabilities** (vision, function calling, thinking, JSON mode) for use by the capability routing policy
6. Click **Save**

You can also **Clone** an existing model entry to register a fine-tune or variant quickly.

---

## Model Configuration Fields

| Field | Description |
|-------|-------------|
| **Model ID** | The identifier sent to the provider API (e.g. `gpt-5-mini`) |
| **Provider** | One of `openai`, `anthropic`, `gemini`, `mistral`, `cohere`, `xai`, `ollama`, `custom` |
| **API Key** | Provider API key (AES-256 encrypted at rest) |
| **Base URL** | Override the provider endpoint (useful for proxies and custom providers) |
| **Input price** | Price per 1 million input tokens in USD |
| **Output price** | Price per 1 million output tokens in USD |
| **Cache price** | Price per 1 million cached input tokens (if the provider supports it) |
| **Context window** | Maximum number of tokens the model accepts |
| **Pricing tiers** | Optional: higher prices above a token-count threshold (see below) |
| **Capabilities** | `vision`, `functionCalling`, `thinking`, `json` |
| **Enabled** | Toggle to temporarily disable a model without deleting it |

---

## Pricing Tiers

Some models have different prices for long-context requests. You can configure a pricing tier that applies above a token threshold.

**Example — Anthropic claude-opus-4-6:**

| Range | Input | Output |
|-------|-------|--------|
| ≤ 200k tokens | $5 / 1M | $25 / 1M |
| > 200k tokens | $10 / 1M | $37.5 / 1M |

When Routerly calculates cost for a request, it checks the total token count and applies the appropriate tier automatically.

---

## Capabilities

Capabilities control which models the **capability** routing policy will select. Set them accurately to get correct routing behaviour.

| Capability | Description |
|-----------|-------------|
| `vision` | Model can process image inputs |
| `functionCalling` | Model supports tool/function call format |
| `thinking` | Model exposes chain-of-thought (e.g. o1, o3, Claude with extended thinking) |
| `json` | Model reliably generates valid JSON with `response_format: {type: "json_object"}` |

---

## Assigning Models to Projects

A model is not usable in a project until it is assigned. When creating a project via CLI, use `--models`:

```bash
routerly project add --name "My App" --slug my-app --models gpt-5-mini,claude-haiku-4-5
```

From the dashboard, open the project → **Routing** tab, then drag and drop models into the routing configuration.

---

## Cloning a Model

Cloning is useful when you have a fine-tuned variant of a base model and want to reuse its pricing configuration:

1. Click the **Clone** icon next to a model in the list
2. Change the Model ID and API Key
3. Adjust pricing if your fine-tune has different rates
4. Save

---

## Removing a Model

:::warning
Removing a model that is assigned to active projects will cause routing failures for those projects. Remove the model from all project configurations first.
:::

```bash
routerly model remove --id gpt-5-mini
```
