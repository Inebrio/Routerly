<div align="center">
  <img src="docs/logo.svg" width="110" alt="Routerly" />
  <h1>Routerly</h1>
  <p><strong>Smart routing for all your AI models.</strong></p>
  <p>Self-hosted API gateway that acts as a drop-in replacement for OpenAI and Anthropic APIs.<br>
  Route requests intelligently across multiple providers, track costs, and enforce budgets.</p>

  ![Node.js ≥ 20](https://img.shields.io/badge/Node.js-%E2%89%A520-green)
  ![License: MIT](https://img.shields.io/badge/License-MIT-blue)
</div>

---

## What is Routerly?

Routerly sits between your application and your LLM providers. It exposes the same API surface as
OpenAI and Anthropic, so you swap one base URL and gain intelligent routing, cost visibility, budgets,
and project isolation — with zero changes to your client code.

When a request arrives, Routerly asks a *routing model* to score all registered candidates, picks the
best one within budget, forwards the request, and records usage.

```
Your App
   │
   │  POST /v1/chat/completions
   ▼
┌─────────────────────────────────────────────┐
│                  Routerly                   │
│  Auth → Route → Budget check → Proxy        │
└────────────┬──────────┬──────────┬──────────┘
             │          │          │
          OpenAI    Anthropic   Ollama / Gemini / …
```

If a provider fails, Routerly falls back to the next best candidate automatically.
If all candidates fail, it returns HTTP 503.

---

## Key Features

- **Intelligent routing** — a routing model scores candidate models using configurable policies
  (cheapest, fastest, healthiest, most capable, budget-aware, and more)
- **Multi-provider** — OpenAI, Anthropic, Gemini, Ollama, Mistral, Cohere, xAI, and custom HTTP endpoints
- **Drop-in compatibility** — implements OpenAI (`/v1/chat/completions`, `/v1/responses`) and
  Anthropic (`/v1/messages`) wire formats, including streaming
- **Cost tracking** — per-token pricing applied to every call; usage persisted locally
- **Budget enforcement** — hourly/daily/weekly/monthly/per-request limits per project, per token, or globally
- **Project isolation** — separate Bearer tokens per project; each project has its own model list and budget
- **Web dashboard** — visual analytics, model management, project configuration, user and role admin
- **Admin CLI** — full management interface from the terminal

---

## The Three Components

| Component | Description | Docs |
|-----------|-------------|------|
| **Service** | Fastify proxy server. Handles auth, routing, provider adapters, cost tracking, budget enforcement. The core of Routerly. | [docs/service/](docs/service/README.md) |
| **Dashboard** | React SPA served by the service. Manage models, projects, users, roles, and view usage analytics. | [docs/dashboard/](docs/dashboard/README.md) |
| **CLI** | Commander.js admin tool. Connects to the service REST API to manage every resource from your terminal. | [docs/cli/](docs/cli/README.md) |

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/your-org/routerly.git
cd routerly
npm install
```

### 2. Generate a secret key

All API keys and project tokens are encrypted at rest with AES-256. Set this before anything else:

```bash
export ROUTERLY_SECRET_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
# Save to your shell profile so it persists across sessions
echo "export ROUTERLY_SECRET_KEY=\"$ROUTERLY_SECRET_KEY\"" >> ~/.zshrc
```

### 3. Register a model

```bash
npx routerly model add \
  --id gpt-4o \
  --provider openai \
  --api-key sk-YOUR_OPENAI_KEY
```

Pricing presets are applied automatically for known model IDs.

### 4. Create a project

```bash
npx routerly project add \
  --name "My App" \
  --slug my-app \
  --routing-model gpt-4o \
  --models gpt-4o
```

This prints your **project Bearer token** — save it.

### 5. Start the service

```bash
npx routerly start
# or in development mode with hot-reload:
npm run dev
```

### 6. Make your first request

Replace your existing OpenAI base URL and API key — everything else stays the same.

**Python:**
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="YOUR_PROJECT_TOKEN"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

**curl:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROJECT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Supported Providers

| Provider | Key required | Streaming | Pricing presets |
|----------|:------------:|:---------:|:---------------:|
| OpenAI | ✓ | ✓ | ✓ |
| Anthropic | ✓ | ✓ | ✓ |
| Google Gemini | ✓ | ✓ | ✓ |
| Ollama (local) | — | ✓ | — |
| Mistral | ✓ | ✓ | ✓ |
| Cohere | ✓ | ✓ | ✓ |
| xAI (Grok) | ✓ | ✓ | ✓ |
| Custom HTTP | optional | ✓ | — |

---

## Documentation

| Section | Description |
|---------|-------------|
| [Getting Started](docs/getting-started/installation.md) | Installation, quick-start, and configuration reference |
| [Service](docs/service/README.md) | Architecture, routing engine, provider adapters, budgets, API reference |
| [Dashboard](docs/dashboard/README.md) | UI walkthrough: models, projects, users, analytics |
| [CLI](docs/cli/README.md) | Command reference and usage examples |
| [Contributing](docs/contributing/development.md) | Dev setup, adding policies, adding providers |

---

## Configuration

All configuration is stored in `~/.routerly/` by default. Override with `ROUTERLY_HOME=/custom/path`.

```
~/.routerly/
├── config/
│   ├── settings.json    # port, log level, dashboard toggle
│   ├── models.json      # providers + encrypted API keys + pricing
│   ├── projects.json    # projects + encrypted tokens + model lists
│   ├── users.json       # dashboard users
│   └── roles.json       # roles and permissions
└── data/
    └── usage.json       # per-call usage records
```

See [Configuration Reference](docs/getting-started/configuration.md) for the full settings schema.

---

## Contributing

Contributions are welcome. See the [Development Guide](docs/contributing/development.md) for setup
instructions, workspace scripts, and how to add routing policies or provider adapters.

---

## License

MIT
