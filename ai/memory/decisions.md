# Architectural decisions

Decisions made in the project with their rationale. Useful to avoid re-discussing already settled choices.

---

## Storage: JSON files (no database)

**Decision**: all configuration and usage data is stored in JSON files under `ROUTERLY_HOME`.

**Rationale**: pure self-hosting — zero infrastructure dependencies. Users don't need to install PostgreSQL, Redis or MongoDB. A Docker volume is sufficient.

**Implication**: concurrent writes are managed with `proper-lockfile`. No queries, no transactions. For high-volume data (usage log), append-only is used (`appendUsageRecord`).

---

## Auth: two separate systems

**Decision**: Bearer token for the LLM proxy (`/v1/*`), custom HMAC-SHA256 JWT for the dashboard (`/api/*`).

**Rationale**: LLM clients (OpenAI/Anthropic SDKs) use Bearer tokens, not cookies/sessions. The dashboard needs expiring sessions. Separating the two systems maintains drop-in compatibility.

**Implication**: `request.project` (proxy) and `request.dashUser` (dashboard) are separate Fastify decorators. Do not mix them.

---

## JWT: custom implementation (no library)

**Decision**: custom JWT with HMAC-SHA256 using `node:crypto`, not `jsonwebtoken` or `jose`.

**Rationale**: reduces dependencies; HMAC-SHA256 is sufficient for internal symmetric tokens.

**Implication**: format is `base64url(payload).HMAC-SHA256(data, secret)`. Secret is in `config/secret`, generated with `crypto.randomBytes(64)`, chmod 0600. Refresh token: random 40-byte hex string, stored as SHA-256 hash (never the raw value).

---

## Module system: ESM with Node16 resolution

**Decision**: `"type": "module"` + `"moduleResolution": "Node16"` in all packages.

**Rationale**: alignment with Node.js future direction; compatibility with modern AI SDKs that are ESM-only.

**Implication**: **all TypeScript imports must have `.js` extension** (e.g. `import { foo } from './bar.js'`). Node builtins must use the `node:` prefix (e.g. `node:fs`, `node:crypto`). Do not use `require()`.

---

## Provider adapters: common interface

**Decision**: every LLM provider implements the `ProviderAdapter` interface with `chatCompletion`, `streamCompletion`, and optionally `messages` methods.

**Rationale**: isolates provider-specific code from the routing engine. The executor (`llm/executor.ts`) has no knowledge of provider details.

**Implication**: adding a new provider = creating a new file in `packages/service/src/providers/` that implements `ProviderAdapter`.

---

## Routing: policy pipeline with fallback

**Decision**: 10 per-project configurable policies, executed in sequence, each contributing points to the ranking. Fallback iterates the weighted list until exhausted.

**Rationale**: flexibility — each project can have different priorities (cost vs performance vs capability). Automatic fallback increases resilience.

**Implication**: each `PolicyFn` must receive `{ request, candidates, config, ... }` and return `{ routing: [{model, point}], excludes? }`. Do not change the signature without updating all policies.

---

## Dashboard: embedded in the service (same port)

**Decision**: the React SPA is served as static files by the service itself at `/dashboard/`.

**Rationale**: simplified deployment — one container, one process. Users don't need to manage a separate reverse proxy.

**Implication**: `packages/dashboard/dist/` is copied into the Docker image during build. The service serves files via `@fastify/static`. The dashboard can be disabled in `settings.json` (`dashboardEnabled: false`).

---

## Passwords: bcrypt 12 rounds + legacy migration

**Decision**: new passwords use bcrypt 12 rounds. Unsalted SHA-256 hashes (legacy) are silently migrated on the next login.

**Rationale**: non-breaking migration from a less secure system.

**Implication**: never use direct SHA-256 for new passwords. Migration logic is in `plugins/jwt.ts`.

---

## Versioning: synchronized changesets

**Decision**: all packages share the same version, bumped synchronously with `@changesets/cli`.

**Rationale**: simplicity for users (one version to communicate) and for the release process.

**Implication**: `npm run version` bumps all four packages together. CHANGELOGs are per-package at `packages/*/CHANGELOG.md`.
