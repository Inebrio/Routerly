---
title: Continue.dev
sidebar_label: Continue.dev
---

# Continue.dev

[Continue](https://continue.dev) is an open-source AI coding assistant for VS Code and JetBrains. It supports any OpenAI-compatible backend and has first-class support for custom endpoints.

---

## Install

Install the [Continue extension](https://marketplace.visualstudio.com/items?itemName=Continue.continue) from the VS Code Marketplace, or the [JetBrains plugin](https://plugins.jetbrains.com/plugin/22707-continue) from the JetBrains Marketplace.

---

## Configure

Open `~/.continue/config.json` and add Routerly as a model provider:

```json
{
  "models": [
    {
      "title": "Routerly",
      "provider": "openai",
      "model": "gpt-5-mini",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "sk-lr-YOUR_PROJECT_TOKEN"
    }
  ]
}
```

To use the Anthropic Messages API instead:

```json
{
  "models": [
    {
      "title": "Routerly (Anthropic)",
      "provider": "anthropic",
      "model": "claude-haiku-4-5",
      "apiBase": "http://localhost:3000",
      "apiKey": "sk-lr-YOUR_PROJECT_TOKEN"
    }
  ]
}
```

Save the file — Continue reloads configuration automatically.

:::tip
You can add multiple entries pointing at Routerly with different model names. Continue will show them as separate options in its model picker, while Routerly routes them all through the same policy engine.
:::

---

## Usage

Click the Continue icon in the sidebar, select your Routerly model from the picker, and use Chat, Edit, or Autocomplete as normal. Every request is routed through Routerly's engine.
