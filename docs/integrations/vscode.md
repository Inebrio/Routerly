---
title: VS Code
sidebar_label: VS Code
---

# VS Code

[VS Code](https://code.visualstudio.com) offers two main paths to bring LLM features into the editor: **GitHub Copilot** (built-in, OAuth-only) and **third-party AI extensions** such as Continue and Cline that support custom OpenAI-compatible endpoints.

---

## GitHub Copilot

GitHub Copilot authenticates exclusively via **GitHub OAuth** — it sends a GitHub-issued token to the upstream server, not an `sk-lr-*` project token. Routerly expects a Bearer project token and returns **401** for any other credential, so routing Copilot through Routerly is not possible. The authentication schemes are fundamentally incompatible.

:::info Alternativa consigliata
Usa [Continue](./continue) o [Cline](./cline) in VS Code. Entrambe le estensioni supportano un base URL OpenAI-compatible personalizzato e si autenticano con un project token esattamente come Routerly si aspetta.
:::

---

## Estensioni con endpoint personalizzato

Le estensioni che usano l'API OpenAI e accettano un base URL personalizzato funzionano con Routerly senza modifiche. Due scelte popolari:

| Estensione | Installa | Guida |
|------------|----------|-------|
| Continue | [Marketplace](https://marketplace.visualstudio.com/items?itemName=Continue.continue) | [Continue → Routerly](./continue) |
| Cline | [Marketplace](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) | [Cline → Routerly](./cline) |

Entrambe seguono lo stesso schema: imposta il **base URL** su `http://localhost:3000/v1` e l'**API key** sul tuo project token.

---

## Language Model API (vscode.lm)

Le estensioni VS Code che usano la [Language Model API](https://code.visualstudio.com/api/extension-guides/language-model) built-in instradano le richieste attraverso il backend di Copilot e sono quindi soggette alla stessa limitazione OAuth descritta sopra. Le estensioni custom-endpoint come Continue e Cline bypassano questa API e chiamano Routerly direttamente.
