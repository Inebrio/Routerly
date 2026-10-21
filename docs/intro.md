---
slug: /
title: Introduction
sidebar_position: 1
---

# Routerly

**One gateway. Any AI model. Total control.**

Routerly is the self-hosted decision and control layer for your LLM providers. It sits between your applications and OpenAI, Anthropic, Google Gemini, Ollama and more, **decides** which model serves each request through composable routing policies with explainable decisions, and **controls** who may send what through roles, permissions, budgets, guardrails and audit.

**Wire-format transparent.** Compatible with the OpenAI and Anthropic SDKs out of the box: change the base URL in your client, nothing else. Routerly adds no custom headers and no non-standard fields, and returns the provider's response as received. Payloads change only for features you switch on yourself (PII scrubbing, guardrail steering, token optimizers).

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Routers, orchestrators, passthrough** | A router scores models; an orchestrator forwards to a priority-ordered list of routers; a passthrough forwards the client's own credential to OpenAI or Anthropic |
| **11 routing policies** | `llm`, `semantic-intent`, `model-preference`, `cheapest`, `health`, `performance`, `capability`, `context`, `budget-remaining`, `rate-limit`, `fairness`, combined into one ranking, plus reusable routing profiles (`auto`, `cheap`, `fast`, `coding`) |
| **Explainable decisions** | Routing trace per request, Playground with trace and cost breakdown, per-call usage records |
| **Budgets and cost tracking** | Every call priced per token; hard limits (hourly to yearly, rolling windows) at global, router and token level, enforced before the provider is called |
| **Guardrails and PII scrubbing** | Rule- and judge-based content guardrails and PII policies on requests, responses, or both |
| **8 token optimizers** | `session-dedup`, `ccr`, `rtk`, `headroom`, `json-table`, `relevance`, `caveman`, `llmlingua-2`; off by default, enabled per router |
| **Experiments** | A/B test whole routers against each other with no client change |
| **OpenAI + Anthropic compatible** | `/v1/chat/completions`, `/v1/responses` and `/v1/messages` |
| **Roles and audit** | Custom roles over 26 granular permissions, two-factor authentication, audit log |
| **Notifications** | In-app inbox, email (SMTP, SES, SendGrid, Azure, Google) and webhooks (generic, Slack, Teams, PagerDuty, Discord) |
| **MCP server** | Personal MCP tokens let Claude Code, Cursor, Cline and other MCP clients inspect and adjust Routerly with your permissions |
| **Zero infrastructure** | No database, no Redis: configuration lives in JSON files |
| **Dashboard, CLI, API** | Every function is available in all three |
| **Self-updating** | Update check against GitHub Releases every 24 h. Channels: `latest`, `current`, `next`, `develop`. Update from the dashboard or with `routerly update run` |

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

1. Your app sends a request to Routerly using a **router token** as the Bearer header
2. Routerly authenticates the token and resolves the router
3. Enabled routing policies run in parallel and score each candidate model
4. The highest-scoring model within budget receives the request
5. Response is forwarded back; tokens, cost, and latency are recorded
6. On error or timeout, the next candidate is tried automatically

---

## Use Cases

| Scenario | How Routerly helps |
|----------|--------------------|
| **SaaS & multi-tenant** | One router per tenant, hard spend caps, automatic cheapest-model routing |
| **Local-first development** | Develop against Ollama locally, promote to a hosted model in production — same API, same code |
| **Automatic cost reduction** | Route simple tasks to cheap models, complex ones to capable models |
| **Resilience & failover** | Register the same capability across OpenAI, Claude, and Gemini — Routerly detects failures and reroutes in real time |
| **AI tools & chat UIs** | Cursor, Open WebUI, OpenClaw, LibreChat — any tool that speaks OpenAI or Anthropic format |
| **Model evaluation / A/B testing** | Run an experiment between routers; compare cost, latency, and error rate in the dashboard |

---

## Quick Start

**macOS / Linux:**

```bash
# Install the current release (default channel)
curl -fsSL https://www.routerly.ai/install.sh | bash

# Install latest release
curl -fsSL https://www.routerly.ai/install.sh | bash -s -- --channel latest
```

**Windows (PowerShell):**

```powershell
# Install the current release (default channel)
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"

# Install latest release
powershell -c "& ([scriptblock]::Create((irm https://www.routerly.ai/install.ps1))) -Channel latest"
```

Then create the admin account at `http://localhost:3000/dashboard`, log in from the CLI, register a model and create a router:

```bash
routerly auth login --url http://localhost:3000 --email you@example.com
routerly model add --id gpt-5-mini --provider openai --api-key sk-YOUR_KEY
routerly router create --name "My App"
routerly router model add "My App" gpt-5-mini
```

Open `http://localhost:3000/dashboard` to manage everything from the web UI.

→ See the [Installation guide](./getting-started/installation.md) and [Quick Start tutorial](./getting-started/quick-start.md) for full details.

---

## Comparison

Last verified: 2026-10-21, against each project's public README and documentation. "n/v" means not verifiable from public documentation.

| | **Routerly** (0.5.x) | **LiteLLM** proxy | **Bifrost** | **Portkey** OSS gateway | **OpenRouter** |
|---|---|---|---|---|---|
| Self-hosted | ✅ | ✅ | ✅ | ✅ | ❌ hosted service |
| Open source | AGPL-3.0 | open core, enterprise features under a commercial license | Apache-2.0 (enterprise tier exists) | MIT (hosted/enterprise tier exists) | n/a |
| OpenAI-compatible API | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic Messages API (`/v1/messages`) | ✅ | ✅ | ✅ (`/anthropic`) | n/v | n/v |
| Database for core use | none (JSON files) | PostgreSQL recommended for production; virtual keys and spend tracking use it | n/v | n/v | n/a |
| Routing | 11 composable policies, profiles, orchestrators | fallback, weighted, latency, cost, usage, least-busy strategies | routing rules, key/provider load balancing, fallbacks | fallbacks, retries, weighted load balancing | n/v |
| LLM- or intent-based routing | ✅ (`llm`, `semantic-intent`) | n/v | n/v | n/v | n/v |
| Budgets / spend control | ✅ global, router, token | ✅ spend tracking and limits per key/team/user | ✅ virtual keys, teams, customers | n/v | n/v |
| Guardrails | ✅ built in (rules, judge, PII) | ✅ | enterprise tier | ✅ input/output checks (PII redaction listed as enterprise) | n/v |
| Token optimizers | ✅ 8, opt-in | n/v | n/v | n/v | n/v |
| MCP | management MCP server (not a tool gateway) | MCP gateway | MCP client and server | MCP gateway (separate product) | n/v |
| Roles and permissions | ✅ custom roles, 26 permissions | n/v (SSO listed as enterprise) | enterprise tier | n/v | n/v |
| SSO (OIDC/LDAP) | not yet | enterprise | enterprise | n/v | n/v |
| Web UI | ✅ dashboard | ✅ admin UI | ✅ built-in | local log console | hosted dashboard |

These gateways overlap with Routerly and are not mutually exclusive: anything that speaks the OpenAI or Anthropic API can be registered behind Routerly as a custom provider.

---

![Routerly dashboard overview showing cost cards, chart, and per-model breakdown](./assets/screenshot-overview.png)

## Next Steps

- [Install Routerly](./getting-started/installation.md)
- [Run through the Quick Start](./getting-started/quick-start.md)
- [Understand routing policies](./concepts/routing.md)
- [Configure budgets and limits](./concepts/budgets-and-limits.md)
- [Explore the API reference](./api/overview.md)
