# Project facts

Immutable facts about Routerly. Do not modify without updating the codebase as well.

---

## Identity

- **Name**: Routerly
- **Version**: 0.1.5 (all packages synchronized via changesets)
- **Purpose**: self-hosted API gateway for LLMs with intelligent routing, cost tracking and per-project isolation
- **Docker image**: `inebrio/routerly:latest`, `inebrio/routerly:vX.Y.Z`
- **Port**: 3000 (default, configurable in `settings.json`)
- **Formal spec**: `spec/LocalRouter_Specification_1.md`

---

## Stack

| Layer | Technology |
|-------|----------|
| Runtime | Node.js ≥ 20 |
| Language | TypeScript 5.x, ESM (`"type": "module"`) |
| Module resolution | Node16 (`.js` extension required in imports) |
| HTTP service | Fastify 5 |
| Frontend | React 18 + React Router v6 + Vite 6 |
| CLI | Commander 14 + Inquirer 13 |
| Validation | Zod 4 |
| Testing | Vitest 3 |
| Linting | ESLint 9 + @typescript-eslint 8 |
| Formatting | Prettier 3 |
| Git hooks | Husky 9 + commitlint 20 (conventional) |
| Versioning | @changesets/cli |

---

## Monorepo

```
packages/
  shared/     shared TypeScript types, no runtime logic, only dep: uuid
  service/    system core, entry: packages/service/src/index.ts
  cli/        binary: routerly, entry: packages/cli/src/index.ts
  dashboard/  SPA, served at /dashboard/ by the service
```

Build order: `shared` → `service` → `cli` → `dashboard`

---

## Supported LLM providers

| Provider | Config identifier | Notes |
|----------|------------------|-------|
| OpenAI | `openai` | SDK openai ^4 |
| Anthropic | `anthropic` | SDK @anthropic-ai/sdk ^0.39 |
| Google Gemini | `gemini` | Google OpenAI-compatible endpoint |
| Ollama | `ollama` | local OpenAI-compatible endpoint |
| Custom | `custom` | any OpenAI-compatible endpoint |

---

## Storage

- No external database
- JSON files in `ROUTERLY_HOME` (default `~/.routerly/`, Docker `/data`)
- 7 config files: `settings.json`, `models.json`, `projects.json`, `users.json`, `roles.json`, `config/secret`, `data/usage.json`

---

## Main endpoints

- `POST /v1/chat/completions` — OpenAI Chat Completions proxy
- `POST /v1/responses` — OpenAI Responses API proxy
- `POST /v1/messages` — Anthropic Messages proxy
- `GET /v1/models` — model list
- `/api/*` — management API (JWT auth)
- `/dashboard/` — web SPA (if enabled)
- `GET /health` — healthcheck

---

## Built-in roles

| Role | Permissions |
|------|------------|
| `admin` | all |
| `operator` | project r/w, model r/w, report:read, user:read |
| `viewer` | project:read, model:read, report:read |
