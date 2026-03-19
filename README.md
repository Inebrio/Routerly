<div align="center">
  <img src="docs/logo.svg" width="120" alt="Routerly" />
  <h1>Routerly</h1>
  <p><strong>One gateway. Any AI model. Total control.</strong></p>
  <p>
    Self-hosted LLM gateway with intelligent routing, cost tracking, and budget enforcement.<br>
    Fully compatible with the OpenAI and Anthropic APIs, swap a URL, nothing else changes.
  </p>
  <p>
    <a href="https://www.routerly.ai/">https://www.routerly.ai/</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js ≥ 20" />
    <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License: MIT" />
    <img src="https://img.shields.io/badge/Self--hosted-✓-6366f1?style=flat-square" alt="Self-hosted" />
    <img src="https://img.shields.io/badge/Docker-supported-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker supported" />
    <img src="https://img.shields.io/badge/OpenAI%20compatible-✓-412991?style=flat-square&logo=openai&logoColor=white" alt="OpenAI compatible" />
    <img src="https://img.shields.io/badge/Anthropic%20compatible-✓-CC785C?style=flat-square" alt="Anthropic compatible" />
  </p>
</div>

---

## Stop paying for the wrong model. Start routing smart.

Every AI request your app sends could be going to a faster, cheaper, or more capable model, but without visibility, you're flying blind.

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

- **Your data never leaves your infrastructure.** Everything runs on your machine or server, no external service, no telemetry, no vendor tracking your prompts.
- **Zero migration cost.** Any app already using the OpenAI or Anthropic SDK works with Routerly out of the box. One environment variable change.
- **Avoid wasted spend automatically.** Route cheap tasks to cheap models, expensive tasks to capable models. Set hard limits per project or per token.
- **No database to manage.** Config and usage data live in plain JSON files. No PostgreSQL, no Redis, no migrations.
- **Modular by design.** The service, the dashboard, and the CLI are independent components, they can run on the same machine or on entirely different ones. Run the gateway on a dedicated server, access the dashboard from your laptop, and manage everything from the CLI wherever you are.

---

## Use Cases

### 🏢 SaaS with multiple tenants
You run a product where different customers have different AI budgets. Create one Routerly project per tenant, assign a monthly spend cap, and let the routing engine automatically pick the cheapest model that fits the request, no code changes in your app, no risk of a single tenant blowing up your OpenAI bill.

### 🧑‍💻 Local-first development
Your team develops against Ollama locally and promotes to GPT-4o in production. Routerly handles both with the same API surface. Point `base_url` at Routerly in all environments and change only the project token, the routing policy handles the rest.

### 💸 Cost optimisation without quality loss
You have a mix of cheap fast models and expensive powerful ones. Configure a project with `cheapest` + `capability` + `context` policies: Routerly will automatically route simple short requests to the cheap model and fall back to the powerful one only when the task demands it. No changes to your application logic.

### 🔁 Resilience and automatic failover
Your production app can't afford downtime when a provider has an outage. Register the same logical capability across multiple providers (e.g. GPT-4o + Claude Sonnet + Gemini Pro) and enable the `health` policy. Routerly detects errors in real time and routes around failing endpoints, your app gets a 200 while the provider is down.

### 🤖 AI coding assistants and chat UIs
Tools like Cursor, Continue.dev, Open WebUI, and LibreChat need a single OpenAI-compatible endpoint. Point them all at Routerly and centrally control which models they can access, how much they can spend, and rotate API keys without touching each tool's config.

### 🔬 Model evaluation and A/B testing
Experimenting with a new model? Create a test project, add both the baseline and the candidate, and configure a `fairness` policy to split traffic evenly. Usage analytics in the dashboard show you cost, latency, and error rate side by side, no external tooling needed.

### 🏠 Home lab / personal AI stack
You run Ollama at home with a few local models and occasionally want to fall back to cloud when a task exceeds their capability. Routerly routes local-first with automatic cloud fallback, keeps a running cost tally, and lets you set a hard monthly cap so cloud costs never surprise you.

### 🌍 Distributed team deployment
The service, the dashboard, and the CLI are fully decoupled, each can run on a different machine. Deploy the gateway on an internal server or a VPS, let your team access the dashboard from their browsers, and manage models and projects from any terminal with the CLI. No shared filesystem required, no agent to install on every workstation.

### 🏛️ Enterprise / corporate environment *(coming soon)*
You're rolling Routerly out across a company where IT already manages identities in Azure AD, Okta, or LDAP. SSO login means your team logs into the dashboard without a separate password, access follows the same joiner/mover/leaver process as every other internal tool, and you can enforce MFA at the identity-provider level. Budget alerts on Slack or email keep finance and engineering teams in sync without anyone polling a dashboard.

---



### 🔀 Intelligent Multi-Policy Routing
Each request is scored against up to 9 pluggable routing policies, applied simultaneously and combined into a final ranking. Routerly picks the best candidate, and falls back automatically if a provider fails.

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
Every request is priced at the token level using up-to-date pricing per model. Costs accumulate per project and per token, and you can set hard limits, hourly, daily, weekly, monthly, or per request, that block overspending before it happens.

### 🔒 Project Isolation
Separate Bearer tokens per project. Each project has its own model list, routing policies, and budget envelope. Perfect for multi-tenant setups or separating dev/staging/production traffic.

### 🌐 Web Dashboard
A built-in React dashboard gives you a live view of spending, call volume, error rates, and per-model breakdown, with real-time auto-refresh. No separate monitoring tool needed.

### 🖥️ Admin CLI
A full-featured command-line tool lets you manage models, projects, users, roles, and pull usage reports, scriptable and CI-friendly.

### 🔔 Multi-Channel Notifications *(coming soon)*
Get alerted when a budget threshold is crossed, a provider goes down, or error rates spike, on the channel you already use. Notifications are fully configurable: Slack, email, webhooks, PagerDuty, and more. Each rule can target a different channel with its own severity filter.

### 🔐 Enterprise SSO *(coming soon)*
Log in to the dashboard with your existing identity provider, Google, Microsoft Entra ID, GitHub, Keycloak, any OAuth 2.0 / OIDC provider, or LDAP. No separate user management required: roles and permissions sync automatically from your directory. Purpose-built for corporate and enterprise environments where user accounts are already centrally managed.

---

## Dashboard

![Overview](docs/assets/screenshot-overview.png)

*Live metrics: total spend, call volume, success rate, and daily cost trend, all in one view.*

![Models](docs/assets/screenshot-models.png)

*Registered models with provider badges, pricing per million tokens, and context window size.*

![Projects](docs/assets/screenshot-projects.png)

*Projects with their active routing policies and assigned model pools at a glance.*

![Usage](docs/assets/screenshot-usage.png)

*Per-model usage breakdown: calls, tokens in/out, errors, and cost, filterable by period, project, and status.*

---

## Works with any OpenAI or Anthropic client

Because Routerly is a wire-compatible proxy, every tool that speaks the OpenAI or Anthropic protocol works without modification.

<div align="center">

| Tool | Protocol | Notes |
|------|----------|-------|
| <img src="https://img.shields.io/badge/OpenAI%20SDK-412991?style=flat-square&logo=openai&logoColor=white" /> | OpenAI | Python, Node.js, .NET, Java, Go, all versions |
| <img src="https://img.shields.io/badge/Anthropic%20SDK-CC785C?style=flat-square" /> | Anthropic | Python and Node.js SDKs, including streaming |
| <img src="https://img.shields.io/badge/Open%20WebUI-1a1a2e?style=flat-square" /> | OpenAI | Set the API base URL in Settings → Connections |
| <img src="https://img.shields.io/badge/OpenClaw-2d2d2d?style=flat-square" /> | Anthropic | Points to `http://localhost:3000` as a custom endpoint |
| <img src="https://img.shields.io/badge/LangChain-1c3c3c?style=flat-square" /> | OpenAI | Use `ChatOpenAI` with `base_url` override |
| <img src="https://img.shields.io/badge/LlamaIndex-fbcfe8?style=flat-square" /> | OpenAI | `OpenAI(api_base=...)` constructor |
| <img src="https://img.shields.io/badge/Cursor-black?style=flat-square" /> | OpenAI | Add a custom model via Settings → Models |
| <img src="https://img.shields.io/badge/Continue.dev-1a73e8?style=flat-square" /> | OpenAI | `config.json`, set `apiBase` to Routerly URL |
| <img src="https://img.shields.io/badge/LibreChat-orange?style=flat-square" /> | OpenAI | Configure as a custom OpenAI endpoint |
| Any `fetch`/`curl` | OpenAI / Anthropic | Standard HTTP, no SDK needed |

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

**macOS / Linux:**
```bash
curl -fsSL https://github.com/Inebrio/Routerly/releases/latest/download/install.sh | bash
```

**Windows (PowerShell):**
```powershell
powershell -c "irm https://github.com/Inebrio/Routerly/releases/latest/download/install.ps1 | iex"
```

**Via Docker (no Node.js required):**
```bash
git clone https://github.com/Inebrio/Routerly.git
cd Routerly
docker compose up -d
```

The installer detects your platform, checks for Node.js 20+ (offering to install it if missing), downloads the latest release, builds the packages, generates your encryption key, optionally sets up an auto-start daemon, and walks you through adding a model, creating a project, and creating an admin user.

Once installed, the three steps to go live:

```bash
# 1. Register a model (pricing preset applied automatically for known models)
routerly model add --id gpt-4o --provider openai --api-key sk-YOUR_KEY

# 2. Create a project (prints your Bearer token, save it)
routerly project add --name "My App" --slug my-app --routing-model gpt-4o --models gpt-4o

# 3. Start the gateway (skip if you configured auto-start during install)
routerly start
```

That's it. Point your existing app at `http://localhost:3000` and use the project token as the API key.

> Need more control? See [Installation options](docs/getting-started/installation.md) for flags, non-interactive mode, system-wide install, and manual setup.

---

## Supported Providers

| Provider | Key required | OpenAI format | Anthropic format | Local |
|----------|:------------:|:-------------:|:----------------:|:-----:|
| **OpenAI** | ✓ | ✓ | - |, |
| **Anthropic** | ✓ | - | ✓ | - |
| **Google Gemini** | ✓ | ✓ | - |, |
| **Ollama** | - | ✓ | - | ✓ |
| **Mistral** | ✓ | ✓ | - |, |
| **Cohere** | ✓ | ✓ | - |, |
| **xAI (Grok)** | ✓ | ✓ | - |, |
| **Custom HTTP** | optional | ✓ | - | optional |

Mix and match freely. A single project can span cloud and local models simultaneously.

---

## How Routerly compares

| | **Routerly** | **LiteLLM** | **OpenRouter** |
|---|:---:|:---:|:---:|
| Self-hosted | ✅ | ✅ | ❌ cloud-only |
| OpenAI-compatible API | ✅ | ✅ | ✅ |
| Native Anthropic API format | ✅ | ❌ | ❌ |
| Local model support (Ollama) | ✅ | ✅ | ❌ |
| BYOT (Bring Your Own Token) | ✅ | ✅ | ❌ |
| LLM-powered smart routing | ✅ | ❌ | ❌ |
| Built-in deterministic routing policies | ✅ | ⚠️ limited | ❌ |
| Budget enforcement | ✅ | ✅ | ✅ |
| Database required | ✅ none | ⚠️ SQLite/PostgreSQL | N/A |
| External infrastructure (Redis, etc.) | ✅ none | ⚠️ optional | N/A |
| Per-project token isolation | ✅ | ✅ | ✅ |
| Web dashboard | ✅ built-in | ✅ | ✅ |
| Admin CLI | ✅ | ✅ | ❌ |
| Data privacy (stays on your infra) | ✅ | ✅ | ❌ |
| Setup complexity | minimal | moderate | none (managed) |
| SSO / LDAP login | 🔜 coming soon | ✅ | ❌ |
| Configurable notifications | 🔜 coming soon | ⚠️ limited | ❌ |

**Routerly is the only option where the gateway itself is intelligent.** LiteLLM and OpenRouter are proxies, they forward requests based on static rules you define upfront. Routerly uses a language model to dynamically evaluate every request in context and pick the best candidate in real time. That means smarter cost savings, better fallback decisions, and routing that adapts to your workload automatically. And if you don't want to involve an LLM, Routerly's built-in deterministic policies (cheapest, health, performance, capability, budget-remaining…) work entirely on their own, no external call needed.

**BYOT, Bring Your Own Token.** With OpenRouter you pay through their platform at marked-up rates, effectively handing your spend and your usage data to a third party. Routerly uses your own API keys directly: every request goes straight from your server to the provider, at the provider's official price, with nobody in between.

**Privacy-first by design.** With OpenRouter, your prompts transit a third-party cloud, full stop. LiteLLM is self-hosted but requires standing up and maintaining a database just to run. Routerly is self-hosted, zero-dependency, and your data never leaves your machine. No Postgres, no Redis, no infrastructure to secure.

**The only gateway with native Anthropic format support.** If you're using the Anthropic SDK directly, not wrapped through OpenAI compatibility, only Routerly handles `/v1/messages` natively. LiteLLM and OpenRouter translate everything to OpenAI format, which means edge cases, subtle incompatibilities, and features like `top_k` or extended thinking that silently don't work.

> **Routerly** is the right choice for the vast majority of teams: self-hosted, intelligent, zero-ops, BYOT, with native support for both OpenAI and Anthropic formats.
> LiteLLM makes sense only if you specifically need one of its 100+ niche provider integrations and are prepared to run and maintain a database.
> OpenRouter is a last resort when you have no server to deploy to and data privacy is not a concern.

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

All configuration lives in `~/.routerly/`, plain JSON, no database.

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

**When running via Docker**, config and data are persisted in the `routerly_data` named volume, mounted at `/data` inside the container (`ROUTERLY_HOME=/data`). No extra setup needed: the directory is created automatically on first start.

---

## Contributing

Contributions are welcome. See the [Development Guide](docs/contributing/development.md).

---

## License

MIT

