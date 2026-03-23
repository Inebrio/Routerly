---
title: Quick Start
sidebar_position: 2
---

# Quick Start

From zero to your first routed AI response in under 5 minutes.

---

## Step 1: Install Routerly

```bash
# macOS / Linux
curl -fsSL https://www.routerly.ai/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"
```

After the installer finishes, start the service if it isn't already running:

```bash
routerly start
```

---

## Step 2: Create Your Admin Account

Open the dashboard:

```
http://localhost:3000/dashboard
```

On first launch you will see the **Setup** screen. Enter an email address and password to create the admin account. This account has full control over all settings.

---

## Step 3: Register a Model

A **model** is a specific LLM available through a provider. You register it once with its API key; Routerly reuses it across all projects.

**Via CLI:**

```bash
# OpenAI
routerly model add --id gpt-5-mini --provider openai --api-key sk-YOUR_KEY

# Anthropic
routerly model add --id claude-haiku-4-5 --provider anthropic --api-key sk-ant-YOUR_KEY

# Ollama (local — no API key needed)
routerly model add --id ollama/qwen3:4b --provider ollama
```

Built-in pricing presets are available for well-known model IDs. If a preset is found, you do not need to specify `--input-price` / `--output-price`.

**Via Dashboard** → **Models** → **+ New Model**: fill in the Model ID, Provider, and API Key. Pricing fields are pre-filled automatically for known models.

---

## Step 4: Create a Project

A **project** is an isolated workspace. It gets its own Bearer token and its own routing configuration.

```bash
routerly project add \
  --name "My App" \
  --slug my-app \
  --models gpt-5-mini
```

The command prints your **project token** — a string starting with `sk-lr-`. Save it; you'll use it in your application.

:::warning Token visibility
The project token is shown **only once** after creation. Store it securely. You can generate a new token from the dashboard at any time.
:::

---

## Step 5: Make Your First API Call

Point any OpenAI-compatible SDK at Routerly and use your project token as the API key.

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-lr-YOUR_PROJECT_TOKEN",
)

response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### TypeScript / Node.js

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-lr-YOUR_PROJECT_TOKEN',
});

const response = await client.chat.completions.create({
  model: 'gpt-5-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```

### curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Step 6: Check Usage

Open **Usage** in the dashboard or use the CLI:

```bash
routerly report usage          # aggregated by model, this month
routerly report calls --limit 10   # last 10 request records
```

---

## Next Steps

- Add more models → [Concepts: Models](../concepts/models.md)
- Configure routing policies → [Concepts: Routing](../concepts/routing.md)
- Set spending limits → [Concepts: Budgets & Limits](../concepts/budgets-and-limits.md)
- Invite team members → [Dashboard: Users & Roles](../dashboard/users-and-roles.md)
- Try requests in the browser → [Dashboard: Playground](../dashboard/playground.md)
