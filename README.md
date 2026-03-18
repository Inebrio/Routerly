<div align="center">
  <img src="docs/logo.svg" width="120" alt="Routerly" />
  <h1>Routerly</h1>
  <p><strong>One gateway. Any AI model. Total control.</strong></p>
  <p>
    Self-hosted LLM gateway with intelligent routing, cost tracking, and budget enforcement.<br>
    Fully compatible with the OpenAI and Anthropic APIs — swap a URL, nothing else changes.
  </p>
  <p>
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js ≥ 20" />
    <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License: MIT" />
    <img src="https://img.shields.io/badge/Self--hosted-✓-6366f1?style=flat-square" alt="Self-hosted" />
    <img src="https://img.shields.io/badge/OpenAI%20compatible-✓-412991?style=flat-square&logo=openai&logoColor=white" alt="OpenAI compatible" />
    <img src="https://img.shields.io/badge/Anthropic%20compatible-✓-CC785C?style=flat-square" alt="Anthropic compatible" />
  </p>
</div>

---

## Stop paying for the wrong model. Start routing smart.

Every AI request your app sends could be going to a faster, cheaper, or more capable model — but without visibility, you're flying blind.

Routerly is the missing layer between your code and your LLM providers. It sits quietly in the middle, makes smart routing decisions on every request, keeps a close eye on spending, and enforces budgets before they become bills. Your codebase doesn't need to change at all.

```
Your App  ──────────────────────▶  Routerly  ──▶  OpenAI
                                      │       ──▶  Anthropic
  POST /v1/chat/completions           │       ──▶  Gemini
  (same API, any SDK)                 │       ──▶  Ollama (local)
                                      │       ──▶  Mistral / Cohere / …
                              Auth · Route · Budget
                               Track · Fallback
```

---

## Why Routerly?

- **Your data never leaves your infrastructure.** Everything runs on your machine or server — no external service, no telemetry, no vendor tracking your prompts.
- **Zero migration cost.** Any app already using the OpenAI or Anthropic SDK works with Routerly out of the box. One environment variable change.
- **Avoid wasted spend automatically.** Route cheap tasks to cheap models, expensive tasks to capable models. Set hard limits per project or per token.
- **No database to manage.** Config and usage data live in plain JSON files. No PostgreSQL, no Redis, no migrations.

---

## Key Features

### 🔀 Intelligent Multi-Policy Routing
Each request is scored against up to 9 pluggable routing policies — applied simultaneously and combined into a final ranking. Routerly picks the best candidate, and falls back automatically if a provider fails.

| Policy | What it does |
|--------|-------------|
| `llm` | Asks a language model to pick the best candidate given request context |
| `cheapest` | Minimises cost per token |
| `health` | Deprioritises models with recent errors |
| `performance` | Favours models with lower average latency |
| `capability` | Matches models to task requirements (vision, tools, JSON mode…) |
| `context` | Filters models by context window size relative to the prompt |
| `budget-remaining` | Excludes models that would push a project over its budget |
| `rate-limit` | Steers traffic away from rate-limited providers |
| `fairness` | Balances load across candidates |

### 💰 Real-Time Cost Tracking & Budgets
Every request is priced at the token level using up-to-date pricing per model. Costs accumulate per project and per token, and you can set hard limits — hourly, daily, weekly, monthly, or per request — that block overspending before it happens.

### 🔒 Project Isolation
Separate Bearer tokens per project. Each project has its own model list, routing policies, and budget envelope. Perfect for multi-tenant setups or separating dev/staging/production traffic.

### 🌐 Web Dashboard
A built-in React dashboard gives you a live view of spending, call volume, error rates, and per-model breakdown — with real-time auto-refresh. No separate monitoring tool needed.

### 🖥️ Admin CLI
A full-featured command-line tool lets you manage models, projects, users, roles, and pull usage reports — scriptable and CI-friendly.

---

## Dashboard

![Overview](docs/assets/screenshot-overview.png)

*Live metrics: total spend, call volume, success rate, and daily cost trend — all in one view.*

![Models](docs/assets/screenshot-models.png)

*Registered models with provider badges, pricing per million tokens, and context window size.*

![Projects](docs/assets/screenshot-projects.png)

*Projects with their active routing policies and assigned model pools at a glance.*

![Usage](docs/assets/screenshot-usage.png)

*Per-model usage breakdown: calls, tokens in/out, errors, and cost — filterable by period, project, and status.*

---

## Works with any OpenAI or Anthropic client

Because Routerly is a wire-compatible proxy, every tool that speaks the OpenAI or Anthropic protocol works without modification.

<div align="center">

| Tool | Protocol | Notes |
|------|----------|-------|
| <img src="https://img.shields.io/badge/OpenAI%20SDK-412991?style=flat-square&logo=openai&logoColor=white" /> | OpenAI | Python, Node.js, .NET, Java, Go — all versions |
| <img src="https://img.shields.io/badge/Anthropic%20SDK-CC785C?style=flat-square" /> | Anthropic | Python and Node.js SDKs, including streaming |
| <img src="https://img.shields.io/badge/Open%20WebUI-1a1a2e?style=flat-square" /> | OpenAI | Set the API base URL in Settings → Connections |
| <img src="https://img.shields.io/badge/OpenClaw-2d2d2d?style=flat-square" /> | Anthropic | Points to `http://localhost:3000` as a custom endpoint |
| <img src="https://img.shields.io/badge/LangChain-1c3c3c?style=flat-square" /> | OpenAI | Use `ChatOpenAI` with `base_url` override |
| <img src="https://img.shields.io/badge/LlamaIndex-fbcfe8?style=flat-square" /> | OpenAI | `OpenAI(api_base=...)` constructor |
| <img src="https://img.shields.io/badge/Cursor-black?style=flat-square" /> | OpenAI | Add a custom model via Settings → Models |
| <img src="https://img.shields.io/badge/Continue.dev-1a73e8?style=flat-square" /> | OpenAI | `config.json` — set `apiBase` to Routerly URL |
| <img src="https://img.shields.io/badge/LibreChat-orange?style=flat-square" /> | OpenAI | Configure as a custom OpenAI endpoint |
| Any `fetch`/`curl` | OpenAI / Anthropic | Standard HTTP — no SDK needed |

</div>

**Python example (OpenAI SDK):**
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your-project-token"       # token generated by `routerly project add`
)
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

**Python example (Anthropic SDK):**
```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="your-project-token"
)
message = client.messages.create(
    model="claude-opus-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
```

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/routerly.git && cd routerly && npm install

# 2. Generate an encryption key (keep this safe — everything is encrypted with it)
export ROUTERLY_SECRET_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
echo "export ROUTERLY_SECRET_KEY=\"$ROUTERLY_SECRET_KEY\"" >> ~/.zshrc

# 3. Register a model (pricing preset applied automatically for known models)
npx routerly model add --id gpt-4o --provider openai --api-key sk-YOUR_KEY

# 4. Create a project (prints your Bearer token)
npx routerly project add --name "My App" --slug my-app --routing-model gpt-4o --models gpt-4o

# 5. Start the gateway
npx routerly start
```

That's it. Point your existing app at `http://localhost:3000` and use the project token as the API key.

---

## Supported Providers

| Provider | Key required | OpenAI format | Anthropic format | Local |
|----------|:------------:|:-------------:|:----------------:|:-----:|
| **OpenAI** | ✓ | ✓ | — | — |
| **Anthropic** | ✓ | — | ✓ | — |
| **Google Gemini** | ✓ | ✓ | — | — |
| **Ollama** | — | ✓ | — | ✓ |
| **Mistral** | ✓ | ✓ | — | — |
| **Cohere** | ✓ | ✓ | — | — |
| **xAI (Grok)** | ✓ | ✓ | — | — |
| **Custom HTTP** | optional | ✓ | — | optional |

Mix and match freely. A single project can span cloud and local models simultaneously.

---

## How Routerly compares

| | **Routerly** | **LiteLLM** | **OpenRouter** |
|---|:---:|:---:|:---:|
| Self-hosted | ✅ | ✅ | ❌ cloud-only |
| OpenAI-compatible API | ✅ | ✅ | ✅ |
| Native Anthropic API format | ✅ | ❌ | ❌ |
| Local model support (Ollama) | ✅ | ✅ | ❌ |
| Budget enforcement | ✅ | ✅ | ✅ |
| Database required | ❌ none | ✅ SQLite/PostgreSQL | N/A |
| External infrastructure (Redis, etc.) | ❌ none | optional | N/A |
| LLM-powered smart routing | ✅ | ❌ | ❌ |
| Per-project token isolation | ✅ | ✅ | ✅ |
| Web dashboard | ✅ built-in | ✅ | ✅ |
| Admin CLI | ✅ | ✅ | ❌ |
| Data privacy (stays on your infra) | ✅ | ✅ | ❌ |
| Setup complexity | minimal | moderate | none (managed) |

**When to pick Routerly:** you want full control, data locality, native Anthropic support, LLM-driven routing, and zero infrastructure dependencies.

**When to pick LiteLLM:** you need support for 100+ providers and are comfortable running a database.

**When to pick OpenRouter:** you want a managed service with no self-hosting and access to a large model catalog.

---

## Documentation

| | |
|---|---|
| [Getting Started](docs/getting-started/installation.md) | Install, generate your secret key, run your first request |
| [Service](docs/service/README.md) | Architecture, routing engine, providers, budgets, API reference |
| [Dashboard](docs/dashboard/README.md) | All dashboard pages explained |
| [CLI](docs/cli/README.md) | Every command with examples |
| [Contributing](docs/contributing/development.md) | Dev setup, add a routing policy, add a provider |

---

## Configuration

All configuration lives in `~/.routerly/` — plain JSON, no database.

```
~/.routerly/
├── config/
│   ├── settings.json    # port, log level, dashboard toggle
│   ├── models.json      # providers + AES-256 encrypted API keys
│   ├── projects.json    # projects + encrypted tokens
│   ├── users.json       # dashboard users
│   └── roles.json       # RBAC roles and permissions
└── data/
    └── usage.json       # per-call usage records
```

Override the base path with `ROUTERLY_HOME=/custom/path`.

---

## Contributing

Contributions are welcome. See the [Development Guide](docs/contributing/development.md).

---

## License

MIT

