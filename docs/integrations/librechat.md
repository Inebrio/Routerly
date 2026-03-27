---
title: LibreChat
sidebar_position: 10
---

# LibreChat

[LibreChat](https://www.librechat.ai/) is a self-hosted, open-source chat interface that supports custom OpenAI-compatible endpoints. Routerly integrates as a named endpoint so all your registered models appear automatically inside LibreChat.

---

## Setup

### 1. Configure the endpoint

In your LibreChat `librechat.yaml` configuration file, add a custom endpoint entry:

```yaml
endpoints:
  custom:
    - name: "Routerly"
      apiKey: "sk-lr-YOUR_PROJECT_TOKEN"
      baseURL: "http://localhost:3000/v1"
      models:
        default: ["gpt-5-mini"]
        fetch: false
      titleConvo: true
      titleModel: "gpt-5-mini"
      summarize: false
      summaryModel: "gpt-5-mini"
      forcePrompt: false
      dropParams: []
```

Replace `sk-lr-YOUR_PROJECT_TOKEN` with a valid project token from your Routerly dashboard (**Projects → your project → Tokens**).

### 2. Restart LibreChat

```bash
docker compose restart
# or
npm run start
```

**Routerly** will appear as a selectable endpoint in the LibreChat UI. Any model listed under `models.default` (or dynamically fetched if `fetch: true`) will be available to users.

---

## Fetching models dynamically

Set `fetch: true` to let LibreChat query Routerly's model list at startup:

```yaml
models:
  fetch: true
```

Routerly returns the models registered in the project associated with the token. Users will see exactly the models you have configured in that project.

---

## Tips

- **Multiple projects**: Add one `custom` entry per Routerly project token, each with a distinct `name`.
- **Routing transparency**: Each request goes through Routerly's full routing stack — routing policies, budget enforcement, and cost tracking all apply.
- **API compatibility**: LibreChat uses the OpenAI `/v1/chat/completions` format. Anthropic-format models registered in Routerly are also available because Routerly normalises all requests internally.

---

## Related

- [Open WebUI](./open-webui) — another self-hosted chat UI that works the same way
- [API — LLM Proxy](../api/llm-proxy) — full endpoint reference
- [Concepts — Projects](../concepts/projects) — how project tokens work
