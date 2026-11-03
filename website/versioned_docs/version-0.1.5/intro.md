---
slug: /
title: Introduction
sidebar_position: 1
---

# Routerly

**One gateway. Any AI model. Total control.**

Routerly is a self-hosted LLM API gateway with intelligent routing, cost tracking, and budget enforcement. It sits between your application and your LLM providers — OpenAI, Anthropic, Google Gemini, Ollama, and more — and decides which model to use for every request based on configurable policies.

**Compatible with OpenAI and Anthropic SDKs out of the box.** Change the base URL in your client, nothing else.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Intelligent routing** | 9 configurable policies score every request in parallel — cheapest, fastest, healthiest, most capable, or LLM-powered |
| **Budget enforcement** | Hard limits per model, project, and token. Requests are blocked before being sent to providers |
| **Full cost tracking** | Every API call logged with tokens, USD cost, latency, and routing trace |
| **Multi-project isolation** | Each project has its own API token, model list, routing config, and budget envelope |
| **OpenAI + Anthropic compatible** | Drop-in replacement for both APIs — `/v1/chat/completions` and `/v1/messages` |
| **Zero infrastructure** | No database, no Redis, no PostgreSQL — config lives in JSON files |
| **Web dashboard** | Register models, configure projects, monitor usage, manage users |
| **Admin CLI** | Full management from the terminal with `routerly` commands |
| **RBAC** | Role-based access control with 7 granular permissions and custom roles |
| **Notifications** | Email and webhook alerts via SMTP, SES, SendGrid, Azure, Google, or custom webhook |

---

## How It Works

Point your app — or any AI tool like Cursor, Open WebUI, OpenClaw, or LangChain — at `localhost:3000` instead of the provider's URL. From that moment, Routerly takes over: it picks the best available model for each request, enforces your budget, tracks every token spent, and automatically reroutes if a provider fails.

```
Any Client                 Routerly             Providers
──────────                 ────────             ─────────
Your App   ──▶            Authenticate         OpenAI
Cursor                    Policy scoring  ──▶  Anthropic
Open WebUI  POST /v1/     Select model         Gemini
OpenClaw    chat/         Forward request      Ollama
LangChain   completions   Track cost     ◀──  ...
           ◀──            Return response
```

1. Your app sends a request to Routerly using a **project token** as the Bearer header
2. Routerly authenticates the token and resolves the project
3. Enabled routing policies run in parallel and score each candidate model
4. The highest-scoring model within budget receives the request
5. Response is forwarded back; tokens, cost, and latency are recorded
6. On error or timeout, the next candidate is tried automatically

---

## Use Cases

| Scenario | How Routerly helps |
|----------|--------------------|
| **SaaS & multi-tenant** | One project per tenant, hard spend caps, automatic cheapest-model routing |
| **Local-first development** | Develop against Ollama locally, promote to GPT-4o in production — same API, same code |
| **Automatic cost reduction** | Route simple tasks to cheap models, complex ones to capable models |
| **Resilience & failover** | Register the same capability across OpenAI, Claude, and Gemini — Routerly detects failures and reroutes in real time |
| **AI tools & chat UIs** | Cursor, Open WebUI, OpenClaw, LibreChat — any tool that speaks OpenAI or Anthropic format |
| **Model evaluation / A/B testing** | Split traffic with the fairness policy; compare cost, latency, and error rate in the dashboard |

---

## Quick Start

**macOS / Linux:**

```bash
curl -fsSL https://www.routerly.ai/install.sh | bash
```

**Windows (PowerShell):**

```powershell
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"
```

Then register a model, create a project, and start:

```bash
routerly model add --id gpt-5-mini --provider openai --api-key sk-YOUR_KEY
routerly project add --name "My App" --slug my-app --models gpt-5-mini
routerly start
```

Open `http://localhost:3000/dashboard` to manage everything from the web UI.

→ See the [Installation guide](./getting-started/installation.md) and [Quick Start tutorial](./getting-started/quick-start.md) for full details.

---

## Comparison

> Routerly is the only gateway that combines self-hosting, native Anthropic support, LLM-powered routing, and zero external dependencies.

| | **Routerly** | **LiteLLM** | **OpenRouter** |
|---|:---:|:---:|:---:|
| Self-hosted | ✅ | ✅ | ❌ cloud-only |
| OpenAI-compatible API | ✅ | ✅ | ✅ |
| Native Anthropic API format | ✅ | ❌ | ❌ |
| Local model support (Ollama) | ✅ | ✅ | ❌ |
| LLM-powered smart routing | ✅ | ❌ | ❌ |
| Deterministic routing policies | ✅ | ⚠️ limited | ❌ |
| Budget enforcement | ✅ | ✅ | ✅ |
| Database required | **None** | SQLite / PostgreSQL | N/A |
| External infrastructure | **None** | Optional Redis | N/A |
| Web dashboard | ✅ built-in | ✅ | ✅ |
| Admin CLI | ✅ | ✅ | ❌ |
| Data privacy | ✅ stays local | ✅ | ❌ transits cloud |

---

## Next Steps

- [Install Routerly](./getting-started/installation.md)
- [Run through the Quick Start](./getting-started/quick-start.md)
- [Understand routing policies](./concepts/routing.md)
- [Configure budgets and limits](./concepts/budgets-and-limits.md)
- [Explore the API reference](./api/overview.md)
