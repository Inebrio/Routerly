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

## Router, Orchestrator, Passthrough

A **Router** is the entity your client authenticates against — created with
`routerly router create` or the dashboard's Routers page, stored in
`config/routers.json`. Every Router carries a `kind`, one of three:

| Kind | Targets | Notes |
|------|---------|-------|
| `router` (default) | Models | Today's routing behaviour: policies pick a model from the Router's own model list. Absent `kind` on a record created before this field existed means `router`. |
| `orchestrator` | Other Routers | Its candidate pool (`candidates`, each a `routerId` + optional usage limits, ordered by priority — index 0 is highest) is Routers, not models — an Orchestrator has no `models` list of its own. Candidate detail is opaque to clients: the management API returns only each candidate's resolved `name`, its `routerId`, and its position in the list, never its internal configuration. |
| `passthrough` | A fixed upstream family (OpenAI or Anthropic), optionally alongside real target models | Requires a `slug`, which becomes the URL path segment at `/passthrough/<slug>/*`. The pass-through entry itself forwards the client's own credential unchanged to the real `api.openai.com`/`api.anthropic.com` — no Routerly authentication, no model resolution, and no budgets or usage limits (cost is unknown for traffic Routerly never priced). A Passthrough Router's `models` list can also hold real target models alongside that fixed entry; once a request resolves to one of those, it is scored, authenticated with a Routerly-issued token, and budgeted/metered exactly like a `router`-kind Router's model — only the pass-through entry itself stays exempt. Guardrails and PII policies still apply if configured on the Router, on either path. |

See [Concepts: Routing](./routing.md) for how policies pick among an
`router`-kind Router's models, and for what an Orchestrator's candidate
selection and a Passthrough Router's exemptions mean for a live request.

### Passthrough: which path a request takes

A Passthrough Router's `models` list holds exactly one pass-through entry,
and the entry's position in that list is the entire rule for which of the
two paths above a request takes by default:

- **Pass-through entry at index 0** (ahead of every real model) — raw-forward
  is the default outcome for every request reaching this router through its
  Routerly-issued token; real models are never scored, no matter how many
  are configured.
- **Pass-through entry anywhere else** — real models are scored and routed
  normally, exactly like a `router`-kind Router's models. The pass-through
  entry is then used only as a **last-resort fallback**, when every real
  model turns out ineligible (none resolvable, all over a configured limit,
  or all excluded by a hard policy).

On that fallback, Routerly forwards the client's own request headers to the
upstream provider unchanged — it does not substitute or inject any provider
credential. If the client sent only its Routerly bearer token, which is the
normal case on this token-authenticated lane, the upstream provider will
very likely reject it with its own `401`: the Routerly token buys routing
and policy evaluation on this lane, never authentication to the upstream
provider. A client that wants the fallback to succeed upstream must also
send its own valid upstream credential — the same `Authorization`/`x-api-key`
header the unauthenticated `/passthrough/<slug>/*` path already forwards —
alongside the Routerly bearer token. Routerly does not fail the request
itself on this fallback; it forwards it unaltered and returns whatever the
upstream said, which is the wire-format transparency rule's guarantee, not a
gap.

## Request Lifecycle

When your application sends a chat request to Routerly:

1. **Authentication** — The Bearer token is validated against the list of Router tokens. Skipped entirely for a request reaching a Passthrough Router through its unauthenticated `/passthrough/<slug>/*` path: the request's own `Authorization`/`x-api-key` header is the client's real provider credential, forwarded as-is. A request reaching the same router's real target models through its Routerly-issued token goes through this step exactly like a `router`-kind Router.
2. **Router resolution** — The Router's routing configuration and budget are loaded. A Passthrough Router reached via `/passthrough/<slug>/*` is resolved by its `slug` in the URL path; reached via its Routerly-issued token, it resolves the same way a `router`-kind Router does.
3. **Budget pre-check** — If the Router or any parent budget is exhausted, Routerly returns `503` immediately. Not applied when the request resolves to the pass-through entry itself (cost is unknown for that traffic). Applied normally, exactly like a `router`-kind Router, when it resolves to one of the router's real target models.
4. **Routing** — For a `router`-kind Router, the configured routing policies are applied in priority order to select a model; each policy can score or filter the candidate set. For an `orchestrator`, health/rate-limit/fairness policies score the candidate list and ties break by the candidate's position in the list (index 0 = highest priority, not a stored weight) to pick a target Router instead. For a `passthrough` Router, this step depends on where the pass-through entry sits in its model list ([see above](#passthrough-which-path-a-request-takes)): at index 0 it is skipped entirely; anywhere else it scores the router's real models exactly like a `router`-kind Router, falling back to the pass-through entry only if none turn out eligible.
5. **Provider dispatch** — The request is translated to the target provider's wire format (OpenAI, Anthropic Messages, Gemini, …) and forwarded. A request resolving to a Passthrough Router's pass-through entry forwards the request body and headers unchanged instead.
6. **Streaming or buffering** — If `stream: true`, Routerly SSE-proxies the provider stream. Otherwise it buffers and returns a standard response.
7. **Cost accounting** — Token counts and cost are computed and appended to the usage store. Skipped when the request resolves to the pass-through entry (cost is unknown; the record is still written for the request/response, with no cost figure). Computed normally when it resolves to one of the router's real target models.
8. **Budget update** — All applicable budget windows (token, Router, global) are incremented. Not applied when the request resolved to the pass-through entry. Applied normally when it resolved to one of the router's real target models.
9. **Notifications** — If any budget threshold was crossed, alert channels (email, webhook) are triggered.

---

## Tracing

Every step above is a **pipeline phase**, and each phase runs the modules
registered for it: `ingress`, `protocol.decode`, `request.preprocess` (PII,
guardrails, optimizers), `routing.prepare` (policies and the decision),
`routing.execute` with `upstream.prepare` and `upstream.execute` (the budget
check, the upstream call, retries, fallbacks), `response.postprocess`,
`protocol.encode`, `egress` (what the client is sent) and `finalize`.

Modules do not write to a shared trace object. They publish events on the
service event bus, on topics shaped `trace/<phase>/<module>/<event>`, and the
trace module is the only subscriber: it buffers the entries of a request,
stamping each one with the phase, the module and the moment it arrived. When
the request finishes it publishes the completed trace on `traces/completed`,
which is where the readers pick it up:

| Reader | What it does with the trace |
|--------|-----------------------------|
| Usage | Stores it on the usage record once the trace closes, shown as the [trace view](../dashboard/usage.md#trace-view) grouped by phase |
| Live stream | `GET /api/traces/stream`, the management side channel the [Playground](../dashboard/playground.md) reads while the answer is still streaming |
| Console | Prints every entry as it happens, one line each (see below) |
| Integrations | [Exports](../api/management#trace-export) it as OTLP spans or a signed webhook payload, per integration and with its own sample rate |

A call is accounted when its upstream request returns, but its trace keeps
growing after that -- response guardrails, the PII scan of the answer, what
egress wrote, the recap. The usage record therefore waits for the trace to close
before it is written, so what is stored is the whole request and not the part of
it that happened before the answer came back.

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
is a per-Router opt-in (`traceContent`) for the trace UI, and logs have a different lifetime, so
the line only says whether content was captured (`+content`), not what it said.
And at log level `warn` or `error` it prints failures only -- an operator who
asked for less output does not get the full trace.

---

## Configuration Storage

All state is stored as JSON files on disk under `~/.routerly/` (override with `$ROUTERLY_HOME`). There is no external database dependency.

| File | Contents |
|------|----------|
| `config/settings.json` | Service settings |
| `config/connections.json` | Provider connections (credentials, endpoint) |
| `config/instances.json` | Model instances bound to a connection (pricing, capability overrides) |
| `config/routers.json` | Routers, Orchestrators, Passthrough Routers — routing config, tokens, member roles |
| `config/users.json` | Dashboard users (passwords bcrypt-hashed) |
| `config/roles.json` | Custom RBAC roles |
| `data/usage.ndjson` | Per-request usage records, append-only NDJSON (one JSON object per line) |

`config/routers.json` is migrated automatically and idempotently from the
pre-rename `config/projects.json` on first start; `data/usage.ndjson` is
migrated the same way from a legacy `data/usage.json` array. See
[Config Files](../reference/config-files.md) for the full field reference.

---

## Ports and Protocols

| Endpoint prefix | Protocol | Purpose |
|----------------|----------|---------|
| `/v1/*` | HTTP/1.1 + SSE | LLM proxy — authenticated with Router tokens |
| `/passthrough/<slug>/*` | HTTP/1.1 + SSE | Passthrough Router traffic — unauthenticated by Routerly; the client's own upstream credential is forwarded as-is |
| `/api/*` | HTTP/1.1 | Management API — authenticated with JWT session |
| `/dashboard` | HTTP/1.1 | React SPA |
| `/health` | HTTP/1.1 | Health check (unauthenticated) |
