---
title: Overview
sidebar_position: 1
---

# Service

`packages/service` is the core of Routerly. It is a [Fastify](https://fastify.dev/) HTTP server that handles authentication, intelligent model routing, provider dispatch, cost accounting, and budget enforcement.

The CLI and the dashboard both communicate with the running service over HTTP — there is no other inter-process communication.

---

## Startup Sequence

When the service starts it performs the following steps in order:

1. **`initConfigDirs`** — Creates `~/.routerly/config/` and `~/.routerly/data/` if they do not exist.
2. **`loadSecret`** — Reads the AES-256 encryption key from `~/.routerly/config/secret`, generating and persisting it automatically if missing. API keys are encrypted with this secret at rest.
3. **`readConfig('settings')`** — Loads `settings.json`. Missing file → defaults are written and used.
4. **`buildServer`** — Registers Fastify plugins, routes, and middleware in this order:
   - CORS (`@fastify/cors`)
   - Dashboard static files (`@fastify/static` at `/dashboard`, only if `dashboardEnabled: true`)
   - Management API routes (`/api/*`)
   - Auth guard plugin (validates `Bearer sk-rt-*` tokens for `/v1/*` routes)
   - LLM Proxy routes (`/v1/*`)
   - Root redirect (`/` → `/dashboard/`)
   - Health check (`/health`)
5. **`server.listen`** — Binds to `host:port` from settings (defaults: `0.0.0.0:3000`).

---

## Running Manually

The service is normally managed as a background daemon by the installer. You can also start it directly:

```bash
# From the monorepo root (development)
npm run dev --workspace packages/service

# Standalone binary (after installation)
~/.routerly/app/routerly-service

# Specify a custom config/data directory
ROUTERLY_HOME=/opt/routerly ~/.routerly/app/routerly-service
```

Environment variables override `settings.json` — see [Environment Variables](../reference/environment-variables) for the full list.

---

## Health Check

The service exposes a lightweight health endpoint at `GET /health`:

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "version": "0.1.5",
  "timestamp": "2026-03-27T12:00:00.000Z"
}
```

Returns HTTP 200 when the process is up and accepting connections. This endpoint does **not** require authentication and is suitable for load balancer and container health probes.

---

## Configuration Storage

All state is stored as JSON files on disk — there is no external database. The base directory defaults to `~/.routerly/` and can be overridden with `$ROUTERLY_HOME`.

```
~/.routerly/
├── config/
│   ├── settings.json     # Port, log level, dashboard toggle, timeout, public URL
│   ├── models.json       # Registered LLM models (API keys AES-256 encrypted)
│   ├── projects.json     # Projects, routing policies, tokens, members, budgets
│   ├── users.json        # Dashboard users (passwords bcrypt-hashed)
│   ├── roles.json        # Custom RBAC role definitions
│   └── secret            # AES-256 encryption key (auto-generated, never commit)
└── data/
    └── usage.json        # Append-only call records (tokens, cost, latency, outcome)
```

All writes to config files use a file lock (`proper-lockfile`) to prevent concurrent corruption. Missing files are auto-created with their defaults on first read.

---

## Process Signals

| Signal | Behaviour |
|--------|-----------|
| `SIGTERM` | Graceful shutdown — Fastify drains in-flight requests before exiting |
| `SIGINT` | Same as `SIGTERM` (Ctrl-C in a terminal) |
| `SIGHUP` | Not specially handled — restart the process to reload config |

Config changes made via the CLI or dashboard API take effect immediately (the service re-reads files on each request) without a restart, except for `port` and `host` which require a restart.

---

## Logging

The service uses [pino](https://getpino.io/) via Fastify's built-in logger.

| `NODE_ENV` | Format | Default level |
|------------|--------|---------------|
| development | pretty-printed with colours (`pino-pretty`) | `info` |
| production | JSON (one object per line) | `info` |

Change the log level in `settings.json`, via the dashboard (**Settings → General → Log Level**), or with the `ROUTERLY_LOG_LEVEL` environment variable.

---

## Related

- [Service — HTTP Endpoints](./endpoints) — all routes the service exposes
- [Service — Routing Engine](./routing-engine) — how model selection works
- [Service — Provider Adapters](./providers) — how requests are forwarded to providers
- [Reference — Configuration Files](../reference/config-files)
- [Reference — Environment Variables](../reference/environment-variables)
