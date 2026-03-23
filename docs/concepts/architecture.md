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
                        │  Bearer sk-lr-<token>
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
