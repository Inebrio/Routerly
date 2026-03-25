---
title: VS Code
sidebar_label: VS Code
---

# VS Code

[VS Code](https://code.visualstudio.com) includes GitHub Copilot and a growing set of language-model features that use the OpenAI API. You can redirect them to Routerly by configuring a custom endpoint.

---

## Install

Install [VS Code](https://code.visualstudio.com/download) and the [GitHub Copilot extension](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot).

---

## Configure

VS Code exposes language model settings via `settings.json`. Open it with **Cmd+Shift+P → Open User Settings (JSON)** and add:

```json
{
  "github.copilot.advanced": {
    "debug.overrideEngine": "gpt-5-mini",
    "debug.testOverrideProxyUrl": "http://localhost:3000",
    "debug.overrideProxyUrl": "http://localhost:3000"
  }
}
```

:::note
The Copilot proxy override is an advanced/debug feature. For production teams, prefer using Routerly with a dedicated AI extension such as [Continue](./continue) or [Cline](./cline), which have first-class custom-endpoint support.
:::

For extensions that use the **Language Model API** (`vscode.lm`), set the endpoint inside the extension's own settings panel — look for **Base URL** or **OpenAI endpoint** in its configuration.

---

## Usage

Open Copilot Chat or any Copilot-powered inline feature. Requests are forwarded to Routerly and dispatched according to your routing policy.
