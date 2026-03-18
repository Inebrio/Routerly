# Quick Start

This guide gets you from zero to your first routed AI response in under 5 minutes.

---

## Step 0: Install Routerly

Choose the method that suits your environment.

**macOS / Linux (one-liner):**
```bash
curl -fsSL https://github.com/routerly/routerly/releases/latest/download/install.sh | bash
```

**Windows (PowerShell):**
```powershell
powershell -c "irm https://github.com/routerly/routerly/releases/latest/download/install.ps1 | iex"
```

**Node.js cross-platform installer:**
```bash
curl -fsSL https://github.com/routerly/routerly/releases/latest/download/install.mjs -o install.mjs
node install.mjs
```

**Docker (no Node.js required):**
```bash
git clone https://github.com/routerly/routerly.git
cd routerly
docker compose up -d
```

**From source:**
```bash
git clone https://github.com/routerly/routerly.git
cd routerly
npm install
npm run build
```

After installation the `routerly` binary will be available in your PATH (or via `docker exec routerly routerly <command>` if using Docker).

---

## Overview

```
0. Install → 1. Login → 2. Register a model → 3. Create a project → 4. Start the service → 5. Send a request
```

---

## Step 1: Log In to the CLI

Before running any CLI command you need to authenticate against the running service. If the service is not yet started, launch it first (see Step 4 below), then come back here.

```bash
routerly auth login \
  --url http://localhost:3000 \
  --email admin@example.com \
  --password your-password
```

Omit `--email` and `--password` to be prompted interactively. The session is saved locally; you only need to log in once per server.

---

## Step 2: Register a Model

Use the CLI to register at least one LLM model. Routerly includes built-in pricing presets for
common models, pricing is applied automatically when the model ID matches.

**OpenAI (with auto-pricing):**
```bash
routerly model add \
  --id gpt-4o \
  --provider openai \
  --api-key sk-YOUR_OPENAI_KEY
```

**Anthropic:**
```bash
routerly model add \
  --id claude-3-5-sonnet-20241022 \
  --provider anthropic \
  --api-key sk-ant-YOUR_ANTHROPIC_KEY
```

**Ollama (local, no key):**
```bash
routerly model add \
  --id llama3 \
  --provider ollama \
  --input-price 0 \
  --output-price 0
```

Verify models were registered:
```bash
routerly model list
```

---

## Step 3: Create a Project

A project is an isolated workspace with its own API token, set of models, and routing configuration.

```bash
routerly project add \
  --name "My App" \
  --slug my-app \
  --routing-model gpt-4o-mini \
  --models gpt-4o,llama3
```

The command prints your **project token**, this is shown only once. Save it:

```
✓ Project "My App" created.

Project token (save this, shown only once):
rly_abc123def456...

Endpoint prefix: /projects/my-app/v1/
```

> The `--routing-model` is the model Routerly uses to decide which model from `--models` should
> handle each request. It can be any registered model (a small, cheap model like `gpt-4o-mini` works well).

---

## Step 4: Start the Service

If you configured auto-start during installation, the service is already running. Otherwise:

```bash
routerly start
```

Or start it directly with Node.js:

```bash
node ~/.routerly/app/packages/service/dist/index.js
```

**Docker:** if you installed via Docker Compose the service is already up after `docker compose up -d`.

The service listens on `http://localhost:3000` by default.

> **Note (Docker):** Run CLI commands with `docker exec routerly routerly <command>` instead of calling `routerly` directly. Steps 2 and 3 above can also be run this way.

> **Development mode:** If working from source, use `npm run dev` instead.

---

## Step 5: Make Your First Request

Routerly is a **drop-in replacement** for the OpenAI API. Point your existing client at Routerly
and use your project token as the API key.

**Python (OpenAI SDK):**
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="YOUR_PROJECT_TOKEN"
)

response = client.chat.completions.create(
    model="gpt-4o",   # model hint, used by the routing model to pick the best option
    messages=[{"role": "user", "content": "Hello! Who are you?"}]
)

print(response.choices[0].message.content)
```

**Node.js (OpenAI SDK):**
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'YOUR_PROJECT_TOKEN',
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello! Who are you?' }],
});

console.log(response.choices[0].message.content);
```

**cURL:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PROJECT_TOKEN" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## What Happens Behind the Scenes

When your request arrives:

1. Routerly authenticates your project token
2. The **routing model** (`gpt-4o-mini` in this example) analyzes the request and scores candidate models
3. Budget and limit checks are applied to filter out over-budget models
4. The highest-scoring candidate within budget receives your request
5. The response is returned to your client, usage is recorded automatically
6. If the selected model fails, Routerly falls back to the next candidate

---

## Next Steps

- [Configuration](configuration.md): tune ports, log levels, storage paths
- [Budgets & Limits](../service/budgets-and-limits.md): add per-project spend caps
- [Routing Engine](../service/routing.md): understand and customize routing policies
- [Dashboard](../dashboard/README.md): manage everything via browser UI
