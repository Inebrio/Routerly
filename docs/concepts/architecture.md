---
title: Architecture
sidebar_position: 1
---

# Architecture

Routerly is a self-hosted API gateway that sits between your application and one or more LLM providers. It exposes standard-compatible endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`) so existing SDKs work without modification.

---

## Component Overview

```
┌────────────────────────────────────────────────────────────────┐
│                          Any Client                            │
│                                                                │
│  Your App  │  OpenAI / Anthropic SDK  │  Cursor  │  Open WebUI│
│            │  LibreChat  │  OpenClaw  │  LangChain / LlamaIndex│
└───────────────────────┬────────────────────────────────────────┘
                        │  Bearer sk-rt-<token>
                        │  POST /v1/chat/completions  (OpenAI)
                        │  POST /v1/messages          (Anthropic)
                        ▼
┌─────────────────────────────────────────────────────┐
│                   Routerly Service                  │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │ Auth Guard │  │   Router   │  │ Budget Guard │  │
│  └────────────┘  └─────┬──────┘  └──────────────┘  │
│                        │                            │
│  ┌─────────────────────▼────────────────────────┐   │
│  │              Provider Adapters               │   │
│  │  OpenAI · Anthropic · Gemini · Mistral · … │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
  ┌─────────────┐       ┌─────────────┐
  │  OpenAI API │  …    │ Ollama API  │
  └─────────────┘       └─────────────┘
```

---

## Packages

Routerly is a monorepo composed of four packages:

| Package | Description |
|---------|-------------|
| `packages/service` | The core Fastify HTTP server, routing engine, and provider adapters |
| `packages/dashboard` | The React + Vite web UI served at `/dashboard` |
| `packages/cli` | The `routerly` CLI tool (Commander.js) |
| `packages/shared` | Shared TypeScript types, provider definitions, and utilities |

---

## Request Lifecycle

When your application sends a chat request to Routerly:

1. **Authentication** — The Bearer token is validated against the list of project tokens.
2. **Project resolution** — The project's routing configuration and budget are loaded.
3. **Budget pre-check** — If the project or any parent budget is exhausted, Routerly returns `503` immediately.
4. **Routing** — The configured routing policies are applied in priority order to select a model. Each policy can score or filter the candidate set.
5. **Provider dispatch** — The request is translated to the target provider's wire format (OpenAI, Anthropic Messages, Gemini, …) and forwarded.
6. **Streaming or buffering** — If `stream: true`, Routerly SSE-proxies the provider stream. Otherwise it buffers and returns a standard response.
7. **Cost accounting** — Token counts and cost are computed and appended to `usage.json`.
8. **Budget update** — All applicable budget windows (token, project, global) are incremented.
9. **Notifications** — If any budget threshold was crossed, alert channels (email, webhook) are triggered.

---

## Tracing

Every step above is a **pipeline phase**, and each phase runs the modules
registered for it: `ingress`, `request.preprocess` (PII, guardrails,
optimizers), `routing.prepare` (policies and the decision), `routing.execute`
(the upstream call, retries, fallbacks), `response.postprocess`, `finalize`.

Modules do not write to a shared trace object. They publish events on the
service event bus, on topics shaped `trace/<phase>/<module>/<event>`, and the
trace module is the only subscriber: it buffers the entries of a request,
stamping each one with the phase, the module and the moment it arrived. When
the request finishes it publishes the completed trace on `traces/completed`,
which is where the readers pick it up:

| Reader | What it does with the trace |
|--------|-----------------------------|
| Usage | Stores it on the usage record, shown as the [trace view](../dashboard/usage.md#trace-view) grouped by phase |
| Live stream | `GET /api/traces/stream`, the management side channel the [Playground](../dashboard/playground.md) reads while the answer is still streaming |
| Console | Prints every entry as it happens, one line each (see below) |
| Integrations | [Exports](../api/management#trace-export) it as OTLP spans or a signed webhook payload, per integration and with its own sample rate |

Before it publishes, the trace module appends one derived entry, `trace:recap`:
the request in a single object (outcome, model, attempts, tokens, cost,
guardrails, PII, optimizers, router overhead, errors). Every number in it comes
from an entry already in the buffer, so it cannot disagree with the detail, and
each reader gets the same aggregate instead of computing its own.

Adding a module to the pipeline therefore adds it to the trace, to the live
stream, to the console and to every export, without touching any of them.
Nothing about this reaches the LLM wire: the proxied request and response carry
no Routerly header and no Routerly field.

### The trace on the console

The whole trace is written to the process streams as it happens, one line per
entry:

```
trace <traceId> <phase>/<module> <message> <details JSON>[ +content]
```

Failures -- anything reporting an error, a block, or a failed outcome -- go to
**stderr**; everything else goes to **stdout**. Ordinary shell plumbing works
on it (`routerly start 2> errors.log`), and Docker and systemd capture both.

Two things it never does: it does not print prompts or answers. `entry.content`
is a per-project opt-in for the trace UI, and logs have a different lifetime, so
the line only says whether content was captured (`+content`), not what it said.
And at log level `warn` or `error` it prints failures only -- an operator who
asked for less output does not get the full trace.

---

## Configuration Storage

All state is stored as JSON files on disk under `~/.routerly/` (override with `$ROUTERLY_HOME`). There is no external database dependency.

| File | Contents |
|------|----------|
| `config/settings.json` | Service settings |
| `config/models.json` | Registered LLM models (API keys AES-encrypted) |
| `config/projects.json` | Projects, routing, tokens, member roles |
| `config/users.json` | Dashboard users (passwords bcrypt-hashed) |
| `config/roles.json` | Custom RBAC roles |
| `data/usage.json` | Per-request usage records (append-only) |

---

## Ports and Protocols

| Endpoint prefix | Protocol | Purpose |
|----------------|----------|---------|
| `/v1/*` | HTTP/1.1 + SSE | LLM proxy — authenticated with project tokens |
| `/api/*` | HTTP/1.1 | Management API — authenticated with JWT session |
| `/dashboard` | HTTP/1.1 | React SPA |
| `/health` | HTTP/1.1 | Health check (unauthenticated) |
