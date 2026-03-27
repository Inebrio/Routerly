---
title: Models
sidebar_position: 3
---

# Dashboard: Models

The Models page lets you register, edit, clone, and remove LLM models. All models registered here become available for use in project routing configurations.

---

## Model List

The list shows all registered models with the following columns:

| Column | Description |
|--------|-------------|
| **Model ID** | Provider model identifier |
| **Provider** | OpenAI, Anthropic, Gemini, etc. |
| **Input Price** | USD per 1M input tokens |
| **Output Price** | USD per 1M output tokens |
| **Context Window** | Maximum tokens accepted |
| **Capabilities** | Icons for vision, function calling, thinking, JSON |
| **Enabled** | Toggle on/off without deleting |

Click any column header to sort.

---

## Adding a Model

1. Click **+ New Model**
2. Fill in the form:
   - **Model ID** — the identifier sent to the provider (e.g. `gpt-5-mini`)
   - **Provider** — select from the dropdown
   - **API Key** — encrypted at rest; leave blank for Ollama / custom models without auth
   - **Base URL** — optional override (useful for proxies or self-hosted models)
   - **Context Window** — pre-filled for known models
   - **Pricing** — input/output/cache prices per 1M tokens; pre-filled for known models
   - **Pricing Tiers** — add a tier for long-context pricing (e.g. Anthropic above 200k tokens)
   - **Capabilities** — check all that apply

3. Click **Save**

---

## Editing a Model

Click the **Edit** (pencil) icon next to a model. All fields except the Model ID are editable.

To update the API key, enter a new value — Routerly re-encrypts it immediately.

---

## Cloning a Model

Click the **Clone** icon to create a copy of a model entry. Useful when registering a fine-tuned variant that shares the same provider and pricing as a base model.

Change the **Model ID** and **API Key** as needed, then save.

---

## Disabling a Model

Toggle the **Enabled** switch to `off` to temporarily remove a model from routing without deleting it. Disabled models are visible in the list but are excluded from all routing decisions.

---

## Removing a Model

Click the **Delete** (trash) icon. You will be asked to confirm.

:::warning
Removing a model that is assigned to active project routing configurations will cause routing failures for those projects. Remove the model from all project routing configs before deleting it.
:::
