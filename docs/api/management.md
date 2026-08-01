---
title: Management API
sidebar_position: 3
---

# Management API

The management API is used by the dashboard and CLI. All endpoints require a JWT session token.

**Base URL:** `http://localhost:3000/api`

**Authentication:** `Authorization: Bearer <jwt>`

Obtain a JWT via [POST /api/auth/login](#login).

---

## Authentication

### Login

```
POST /api/auth/login
```

```json
{ "email": "admin@example.com", "password": "your-password" }
```

**Response:**
```json
{
  "token": "eyJ...",
  "refreshToken": "a3f8c2...",
  "user": { "id": "uuid", "email": "admin@example.com", "role": "admin", "permissions": [] }
}
```

- `token` - short-lived JWT (1 hour). Use as `Authorization: Bearer <token>` on all other endpoints.
- `refreshToken` - opaque token used to obtain new access tokens without re-entering credentials. Store securely; see [POST /api/auth/refresh](#refresh). Rotates on every use.

### Refresh

```
POST /api/auth/refresh
```

This endpoint is **public** (no `Authorization` header required).

```json
{ "refreshToken": "a3f8c2..." }
```

**Response:**
```json
{
  "token": "eyJ...",
  "refreshToken": "b9d4e1...",
  "user": { "id": "uuid", "email": "admin@example.com", "role": "admin", "permissions": [] }
}
```

Issues a new 1-hour access token **and a new refresh token** (rotation). The previous refresh token is immediately invalidated - replace it with the value returned in the response. Returns `401` if the token is invalid or has already been used/revoked.

:::note
The CLI and dashboard perform this refresh automatically - the CLI tries silently when the token expires or is within 5 minutes of expiry; the dashboard retries on any `401` response. Both clients persist the new refresh token automatically.
:::

---

## Setup

### Check Setup Status

```
GET /api/setup/status
```

Returns `{ "configured": false }` if no admin account exists yet; `{ "configured": true }` otherwise.

### Create First Admin

```
POST /api/setup/first-admin
```

Only available when `configured: false`.

```json
{ "email": "admin@example.com", "password": "secure-password" }
```

---

## Me (Current User)

### Get Profile

```
GET /api/me
```

### Update Profile

```
PUT /api/me
```

```json
{ "email": "new@example.com", "currentPassword": "old", "newPassword": "new" }
```

---

## Models

A model listed here (`ModelConfig`-shaped) is always backed by a
[Model Instance](#model-instances) bound to a [Connection](#connections)
under the hood; these endpoints are a convenience layer over that pair. Each
model in the response carries a `connectionId` pointing at the connection it
resolves against. See [Connections](#connections) and
[Dashboard: Models: Preconfigured vs Custom Connection](../dashboard/models.md#preconfigured-vs-custom-connection)
for the higher-level explanation.

### List Models

```
GET /api/models
```

**Auth**: `Authorization: Bearer <jwt>` (requires `model:read`)

**Response `200`:** array of models, including those on disabled connections.
Each entry includes `connectionId`; secret fields (`apiKey`, `cfClearance`,
and the other provider-specific credential fields) are always redacted, use
[Get Model API Key](#get-model-api-key) to read the plaintext key.

### Create Model

```
POST /api/models
```

**Auth**: `Authorization: Bearer <jwt>` (requires `model:write`)

```json
{
  "id": "gpt-5-mini",
  "provider": "openai",
  "apiKey": "sk-...",
  "inputPerMillion": 0.25,
  "outputPerMillion": 2.0,
  "contextWindow": 128000,
  "capabilities": { "functionCalling": true, "json": true },
  "fieldOverrides": { "inputPerMillion": true }
}
```

**Request fields:**
- `connectionId` (optional): bind the model to an existing connection instead of supplying credentials inline. When present, `apiKey`/`endpoint`/`cfClearance` and the other credential fields are ignored; the connection's provider must match `provider` (`400` otherwise, `404` if `connectionId` does not exist).
- When `connectionId` is **absent**, `apiKey`/`endpoint`/`cfClearance` (and any provider-specific credential fields) are used to create a dedicated, single-model connection with id `conn-for-<id>`, and the model binds to it. This is the same wire shape the endpoint accepted before the connections cutover, so existing integrations are unaffected.
- `fieldOverrides` (optional): object mapping field names to `true` to lock them against catalog sync. Supported fields: `inputPerMillion`, `outputPerMillion`, `cachePerMillion`, `cacheWritePerMillion`, `pricingTiers`, `contextWindow`, `capabilities`.

**Response `201`:** the created model (redacted), including `connectionId`.
- `catalogDefaults` (if model is in catalog): last known catalog values for each tracked field
- `fieldOverrides` (if any): which fields are locked against auto-sync

**Errors**: `409` a model with this `id` already exists · `400` `connectionId` given but its provider does not match `provider` · `404` `connectionId` given but not found · `403` insufficient permissions

### Get Model

```
GET /api/models/:id
```

**Response includes:**
- `connectionId`: the connection this model currently resolves against
- `catalogDefaults` (if model is in catalog): object with keys: `inputPerMillion`, `outputPerMillion`, `cachePerMillion`, `cacheWritePerMillion`, `pricingTiers`, `contextWindow`, `capabilities` (whichever were synced from the catalog)
- `fieldOverrides` (if any): object with field names as keys, all values set to `true`

### Update Model

```
PUT /api/models/:id
```

**Request body** (all fields optional):
```json
{
  "inputPerMillion": 0.5,
  "fieldOverrides": { "inputPerMillion": true, "contextWindow": false }
}
```

Changing a field value automatically sets `fieldOverrides[fieldName] = true`. To unlock a field for auto-sync, send `"fieldOverrides[fieldName] = false"`. When all overrides are cleared, the `fieldOverrides` object is removed from the model config.

**`connectionId` rebinding:**
- Send `connectionId` to rebind the model to a different existing connection (same provider-match / `400`/`404` rules as create). If the model was previously on its own dedicated `conn-for-<id>` connection and no other model still references it, that dedicated connection is deleted as part of the rebind.
- Omit `connectionId`: if the model is currently on a shared connection and the body carries no `apiKey`/`cfClearance`, the shared binding is left untouched (a plain field edit does not silently detach the model from its shared connection). If the model is on its own dedicated connection, or the body includes new credentials, the dedicated `conn-for-<id>` connection is created/updated from them (empty `apiKey`/`cfClearance` keeps the currently stored credentials).
- Renaming a model's `id` (via body `id`) also renames its dedicated connection from `conn-for-<old-id>` to `conn-for-<new-id>` when that connection is still single-model.

### Delete Model

```
DELETE /api/models/:id
```

If the model owned its dedicated `conn-for-<id>` connection and no other model instance references it, the connection is deleted along with the model.

### Get Model API Key

```
GET /api/models/:id/apikey
```

**Auth**: `Authorization: Bearer <jwt>` (requires `model:write`)

Returns the plaintext credential of the connection the model is currently
bound to. To rotate the key, use [Update Model](#update-model) (or, for a
model on a preconfigured connection, [Update Connection](#update-connection))
with a new `apiKey`.

**Response `200`:**
```json
{ "apiKey": "sk-..." }
```

`apiKey` is `null` for oauth/web-session providers (`anthropic-oauth`, `openai-web`, etc.), whose credentials are never returned in plaintext.

**Errors**: `404` model not found · `403` insufficient permissions

---

## Provider Descriptors

### List Provider Descriptors

```
GET /api/providers/descriptors
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:read`)

Returns the static registry of provider types Routerly knows how to connect to
(distinct from the model **catalog** - see [Catalog](#catalog)). Used by the
dashboard to populate the provider dropdown when creating a connection.

**Response `200`:**
```json
[
  {
    "id": "openai",
    "label": "OpenAI",
    "protocol": "openai",
    "supportLevel": "native",
    "nativeCapabilities": { "vision": true, "functionCalling": true, "json": true }
  },
  {
    "id": "anthropic-oauth",
    "label": "Anthropic (OAuth)",
    "protocol": "anthropic",
    "supportLevel": "oauth",
    "nativeCapabilities": { "thinking": true, "vision": true, "functionCalling": true, "json": true }
  }
]
```

**Fields:**
- `id` - provider identifier, used as `providerId` on a connection
- `protocol` - wire protocol the connection speaks: `openai`, `anthropic`, `gemini`, or `custom`
- `supportLevel` - how credentials are supplied: `native` (plain API key), `compatible` (OpenAI-compatible custom endpoint, plain API key), `oauth` (OAuth access/refresh token pair, encrypted at rest), `web` (browser session cookie, encrypted at rest)
- `nativeCapabilities` - capability flags (`thinking`, `vision`, `functionCalling`, `json`, `embedding`) the provider natively supports, used as defaults for model instances

**Errors**: `403` insufficient permissions

---

## Connections

A connection stores credentials for one account with one provider (see
`providerId`, from [Provider Descriptors](#provider-descriptors)). A connection
does not expose any models by itself - create [Model Instances](#model-instances)
on top of it to make models routable.

### List Connections

```
GET /api/connections
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:read`)

**Response `200`:** array of connections with `credentials` always `undefined` (never returned by any connections endpoint, on any provider `supportLevel`).
```json
[
  { "id": "conn-uuid", "providerId": "openai", "label": "Main OpenAI", "enabled": true }
]
```

**Errors**: `403` insufficient permissions

### Create Connection

```
POST /api/connections
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:manage`)

```json
{
  "providerId": "openai",
  "label": "Main OpenAI",
  "credentials": { "apiKey": "sk-..." },
  "endpoint": "https://api.openai.com/v1",
  "enabled": true
}
```

**Fields:**
- `providerId` - must match a known provider id from [Provider Descriptors](#provider-descriptors) (required)
- `label` - friendly name (required)
- `credentials` - arbitrary key-value object; shape depends on `supportLevel` (required, may be `{}`). See **Credential encryption** below
- `endpoint` - override base URL, e.g. for `custom`/Azure-style deployments (optional)
- `enabled` - whether the connection is usable by routing (required)

**Credential encryption (oauth/web providers):**

For providers with `supportLevel: "oauth"` or `"web"`, plaintext credential
fields are encrypted server-side before being written to disk, and the
plaintext keys are stripped from the stored config. The API never returns
`credentials` on any response, on any provider.

| `supportLevel` | Plaintext input field | Stored (encrypted) field | Required |
|---|---|---|---|
| `oauth` | `oauthPlain` | `oauthEnc` | yes |
| `oauth` | `refreshPlain` | `refreshEnc` | no |
| `web` | `cookiePlain` | `cookieEnc` | yes |
| `web` | `cfClearancePlain` | `cfClearanceEnc` | no (openai-web only) |

Any other field on `credentials` (e.g. `expiresAt` for oauth providers) passes
through untouched. For `native`/`compatible` providers (e.g. plain `apiKey`),
`credentials` passes through entirely untouched - plaintext-at-rest is
intentional for those providers.

**Response `200`:** the created connection, `credentials` omitted (see List Connections above).

**Errors**: `400` invalid body / unknown `providerId` · `403` insufficient permissions or `module_disabled` (oauth/web connection while the corresponding `provider-oauth`/`provider-web` module is disabled)

### Update Connection

```
PATCH /api/connections/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:manage`)

**Request body** (all fields optional, same shape as create):
```json
{ "label": "Renamed", "credentials": { "oauthPlain": "new-access-token" } }
```

When `credentials` is present in the body, it **replaces** the stored
credentials object wholesale (not a deep merge) - resend every field you want
to keep, following the same `oauthPlain`/`refreshPlain`/`cookiePlain`/`cfClearancePlain`
convention as create. Only the fields present in the submitted `credentials`
object are encrypted; omitted plaintext fields simply don't produce an
encrypted counterpart.

**Response `200`:** the updated connection, `credentials` omitted.

**Errors**: `400` invalid body · `404` connection not found · `403` insufficient permissions or `module_disabled`

### Delete Connection

```
DELETE /api/connections/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:manage`)

**Response**: `204 No Content`

**Errors**: `404` connection not found · `403` insufficient permissions

---

## Model Instances

A model instance exposes one upstream model on top of an existing
[connection](#connections), with its own pricing, context window, limits, and
capability overrides. This is what shows up as a routable model.

### List Instances

```
GET /api/instances
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:read`)

**Response `200`:** array of instances.
```json
[
  {
    "id": "inst-uuid",
    "connectionId": "conn-uuid",
    "upstreamModelId": "gpt-5-mini",
    "cost": { "inputPerMillion": 0.25, "outputPerMillion": 2.0 },
    "contextWindow": 128000,
    "limits": [],
    "capabilities": { "functionCalling": true, "json": true }
  }
]
```

**Errors**: `403` insufficient permissions

### Create Instance

```
POST /api/instances
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:manage`)

```json
{
  "connectionId": "conn-uuid",
  "upstreamModelId": "gpt-5-mini",
  "cost": { "inputPerMillion": 0.25, "outputPerMillion": 2.0 },
  "contextWindow": 128000,
  "limits": [],
  "capabilities": { "functionCalling": true, "json": true }
}
```

**Fields:**
- `connectionId` - id of an existing connection (required)
- `upstreamModelId` - the provider's model id, e.g. `gpt-5-mini` (required)
- `cost` - `{ inputPerMillion, outputPerMillion, cachePerMillion?, cacheWritePerMillion?, pricingTiers? }` (required)
- `contextWindow` - token limit (required)
- `limits` - array of usage limit objects, same shape as [project token limits](#create-token) (optional)
- `capabilities` - `{ thinking?, vision?, functionCalling?, json?, embedding? }`, overrides the connection provider's `nativeCapabilities` (optional)

**Response `200`:** the created instance.

**Errors**: `400` invalid body · `403` insufficient permissions

### Update Instance

```
PATCH /api/instances/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:manage`)

**Request body** (all fields optional, same shape as create).

**Response `200`:** the updated instance.

**Errors**: `400` invalid body · `404` instance not found · `403` insufficient permissions

### Delete Instance

```
DELETE /api/instances/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `connections:manage`)

**Response**: `204 No Content`

**Errors**: `404` instance not found · `403` insufficient permissions

---

## Profiles

A profile bundles one area of a project's configuration into a reusable, named
unit. Its `kind` decides which fields it carries:

| `kind` | Fields |
|--------|--------|
| `routing` | `policies`, `selector`, `fallbackStrategy` |
| `optimizer` | `optimizers` |
| `security` | `guardrails`, `pii` |

Every profile also has `id`, `kind`, `label`, `version`, `builtin` and, when it
was produced by [Clone Profile](#clone-profile), `baseId`.

Routerly ships read-only built-ins per kind (`auto`, `cheap`, `fast`, `coding`;
`optimizer-safe`, `optimizer-balanced`, `optimizer-aggressive`;
`security-standard`, `security-strict`). A project either keeps its own inline
configuration for a kind or is assigned a profile of that kind via
[Assign Project Profiles](#assign-project-profiles); the three kinds are
assigned independently.

See [Concepts: Routing: Routing Profiles](../concepts/routing.md#routing-profiles)
for the selector and fallback strategy reference.

All profile endpoints return `403 module_disabled` when the `profiles` module
is disabled.

### List Profiles

```
GET /api/profiles
GET /api/profiles?kind=routing
```

**Auth**: `Authorization: Bearer <jwt>` (requires `profiles:read`)

Returns the built-ins followed by any user-created profiles. `kind` filters the
result to one kind; omit it to get all three.

**Response `200`:**
```json
[
  {
    "id": "auto",
    "kind": "routing",
    "version": 1,
    "label": "Auto",
    "policies": [
      { "type": "health", "enabled": true },
      { "type": "performance", "enabled": true },
      { "type": "cheapest", "enabled": true },
      { "type": "capability", "enabled": true }
    ],
    "selector": "argmax",
    "fallbackStrategy": "next-best",
    "builtin": true
  },
  {
    "id": "optimizer-safe",
    "kind": "optimizer",
    "version": 1,
    "label": "Safe",
    "optimizers": { "steps": [{ "id": "session-dedup", "enabled": true }] },
    "builtin": true
  },
  {
    "id": "security-standard",
    "kind": "security",
    "version": 1,
    "label": "Standard",
    "guardrails": { "detectInjection": true, "rules": [] },
    "pii": { "policies": [{ "target": "request", "entities": ["EMAIL", "PHONE", "CREDIT_CARD", "SSN", "IBAN"] }] },
    "builtin": true
  }
]
```

**Errors**: `400` `invalid_kind` · `403` insufficient permissions

### Create Profile

```
POST /api/profiles
```

**Auth**: `Authorization: Bearer <jwt>` (requires `profiles:manage`)

```json
{
  "kind": "routing",
  "label": "My Routing Profile",
  "policies": [{ "type": "cheapest", "enabled": true }],
  "selector": "cheapest",
  "fallbackStrategy": "abort"
}
```

**Fields:**
- `kind`: `routing` | `optimizer` | `security` (required, decides which other
  fields are accepted)
- `label`: display name (required, non-empty)
- everything else is optional and defaults to an empty configuration, so
  `{ "kind": "security", "label": "Empty" }` is a valid body that can be filled
  in later with [Update Profile](#update-profile)

**Response `201`:** the created profile (`builtin: false`, `version: 1`).

**Errors**: `400` invalid body · `403` insufficient permissions

### Clone Profile

```
POST /api/profiles/clone
```

**Auth**: `Authorization: Bearer <jwt>` (requires `profiles:manage`)

```json
{ "baseId": "auto", "label": "My Auto Profile" }
```

**Fields:**
- `baseId`: id of the built-in profile to clone (user-owned profiles cannot be
  cloned) (required)
- `label`: display name for the new profile (required, non-empty)

**Response `200`:** the created profile, same kind and configuration as the
base (`builtin: false`, `version: 1`, `baseId` set to the source profile's id).

**Errors**: `400` invalid body or unknown `baseId` · `403` insufficient permissions

### Update Profile

```
PATCH /api/profiles/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `profiles:manage`)

**Request body**: any subset of the fields that belong to the target profile's
kind, at least one required. `kind` itself cannot be changed.

```json
{
  "label": "Renamed Profile",
  "policies": [{ "type": "cheapest", "enabled": true }],
  "selector": "cheapest",
  "fallbackStrategy": "abort"
}
```

Only user-created profiles can be updated. Every successful update bumps the
profile's `version` field by 1.

**Response `200`:** the updated profile.

**Errors**: `400` invalid body (including a field that does not belong to this
profile's kind) · `404` profile not found · `409` `immutable_builtin_profile`
(target id matches a built-in) · `403` insufficient permissions

### Delete Profile

```
DELETE /api/profiles/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `profiles:manage`)

**Response**: `204 No Content`

**Errors**: `404` profile not found · `409` `immutable_builtin_profile`
(target id matches a built-in) · `409` `profile_in_use` (a project still
references it, unassign it first) · `403` insufficient permissions

### Assign Project Profiles

```
PUT /api/projects/:id/profiles
```

**Auth**: `Authorization: Bearer <jwt>` (requires `project:write`)

```json
{ "routing": "auto", "optimizer": null }
```

**Fields** (at least one required, each `string | null`):
- `routing`, `optimizer`, `security`: id of an existing profile of that kind,
  or `null` to clear the assignment and fall back to the project's own inline
  configuration for that kind

Kinds omitted from the body keep their current assignment.

**Response `200`:** the updated project (same shape as
[Get Project](#get-project), `tokens` present with `token` values stripped).

**Errors**: `400` invalid body · `404` project not found or
`profile_not_found` (with the offending `kind`) · `403` insufficient permissions

---

## Optimizers

Prompt/context optimizers reduce a request's token footprint before it is
forwarded to a provider. All 7 ship disabled by default; a project opts in
per-optimizer via its [`optimizers` field](#optimizers-project-field). See
[Concepts: Optimizers](../concepts/optimizers.md) for what each optimizer
does, its class (`lossless` / `recoverable` / `lossy`), the safety gate, and
known limitations (`headroom` is a permanent no-op on live requests today;
`llmlingua-2` uses a placeholder tokenizer).

### List Optimizers

```
GET /api/optimizers
```

**Auth**: `Authorization: Bearer <jwt>` (requires `optimizers:read`)

Read-only catalog of the optimizers installed in the running service,
resolved from the in-memory registry populated at module bootstrap.

**Response `200`:**
```json
[
  { "id": "session-dedup", "klass": "lossless", "installed": true },
  { "id": "ccr", "klass": "recoverable", "installed": true },
  { "id": "rtk", "klass": "recoverable", "installed": true },
  { "id": "headroom", "klass": "lossless", "installed": true },
  { "id": "relevance", "klass": "lossy", "installed": true },
  { "id": "caveman", "klass": "lossy", "installed": true },
  { "id": "llmlingua-2", "klass": "lossy", "installed": true }
]
```

Returns `[]` if the optimizer modules were not bootstrapped.

**Errors**: `403` insufficient permissions

### Preview Optimizers

```
POST /api/optimizers/preview
```

**Auth**: `Authorization: Bearer <jwt>` (requires `optimizers:read`)

Pure dry-run: applies the given steps to sample messages and reports the
token delta per step. **No upstream call is made and no project config is
written.**

```json
{
  "projectId": "proj-uuid",
  "sampleMessages": [{ "role": "user", "content": "Hello, please help me with this." }],
  "steps": [
    { "id": "caveman", "enabled": true },
    { "id": "rtk", "enabled": true }
  ]
}
```

**Fields:**
- `sampleMessages`: message array to run the pipeline over, same shape as an
  [LLM Proxy](./llm-proxy.md) request's `messages` (required, min 1)
- `steps`: the optimizer steps to dry-run, same shape as the
  [`optimizers` project field](#optimizers-project-field) (required)
- `projectId`: optional. When given, the preview runs "as" that project (its
  other config is read; nothing is written); `404` if unknown. The `steps`
  in the request body still drive which optimizers run. The project's own
  saved `optimizers.steps` are not substituted in

**Response `200`:**
```json
{
  "estimatedTokensBefore": 55,
  "estimatedTokensAfter": 30,
  "perStep": [
    { "id": "caveman", "before": 55, "after": 30 },
    { "id": "rtk", "before": 30, "after": 30 }
  ]
}
```

A `lossy` step whose result would fail the safety gate is reported
unchanged (`before === after`), mirroring what happens on a live request.
Context-dependent optimizers (`headroom`) are inert in preview, matching
their live no-op state (see [Concepts:
Optimizers](../concepts/optimizers.md#headroom)).

**Errors**: `400` invalid body · `404` `projectId` given but not found ·
`403` insufficient permissions

---

## Projects

### List Projects

```
GET /api/projects
```

### Create Project

```
POST /api/projects
```

```json
{
  "name": "My App",
  "slug": "my-app",
  "timeoutMs": 2000,
  "models": ["gpt-5-mini"]
}
```

### Get Project

```
GET /api/projects/:slug
```

### Update Project

```
PUT /api/projects/:slug
```

On `PUT`, the `guardrails` and `pii` fields are optional: omit a field to leave it
unchanged, send `null` to clear it, or send an object to replace it.

### Content Guardrails and PII (project fields)

A project may carry two optional security blocks, accepted by both
`POST /api/projects` and `PUT /api/projects/:slug` and validated server-side.
Use `PATCH /api/projects/:id/guardrails` for partial updates (guardrails or PII only).

#### Guardrails

Guardrails evaluate each request and/or response against an ordered list of independent rules;
each enabled rule is evaluated in sequence and triggers its configured actions independently.

```json
{
  "guardrails": {
    "detectInjection": true,
    "rules": [
      {
        "type": "regex",
        "enabled": true,
        "target": "request",
        "block": true,
        "log": false,
        "config": { "patterns": ["competitor", "rival\\s+product"] }
      },
      {
        "type": "semantic",
        "enabled": true,
        "target": "both",
        "block": true,
        "log": true,
        "config": {
          "embeddingModelId": "text-embedding-3-small",
          "fallbackModelIds": ["text-embedding-3-large"],
          "examples": ["example of blocked content"],
          "threshold": 0.82
        }
      },
      {
        "type": "topic",
        "enabled": true,
        "target": "request",
        "inject": true,
        "config": {
          "modelId": "claude-haiku-4-5",
          "fallbackModelIds": ["gpt-4-mini"],
          "allowedTopics": "Customer support questions about our product only",
          "threshold": 0.5
        }
      },
      {
        "type": "topic",
        "enabled": true,
        "target": "response",
        "config": {
          "modelId": "claude-haiku-4-5",
          "fallbackModelIds": ["gpt-4-mini"],
          "allowedTopics": "Customer support questions about our product only",
          "threshold": 0.5
        }
      },
      {
        "type": "moderation",
        "enabled": true,
        "target": "request",
        "inject": false,
        "config": { 
          "modelId": "claude-haiku-4-5",
          "fallbackModelIds": ["gpt-4-mini"],
          "threshold": 0.5,
          "systemPrompt": "You are a content safety classifier for customer support conversations."
        }
      }
    ]
  }
}
```

**Rule types:**

| Type | Target | Config fields | Description |
|------|--------|---------------|-------------|
| `regex` | request / response / both | `patterns: string[]` | Block text matching any regex pattern (case-insensitive) |
| `semantic` | request / response / both | `embeddingModelId`, `fallbackModelIds?: string[]`, `examples: string[]`, `threshold?: number` (default 0.82) | Block semantically similar content using embedding cosine similarity; fallback models tried in order if primary fails |
| `topic` | request / response / both (or omitted for inject-only) | `modelId` (optional for inject-only), `fallbackModelIds?: string[]`, `allowedTopics: string`, `threshold?: number` (default 0.5) | LLM judge: block content not matching the allowed topics description; fallback judges tried in order if primary fails. When `target` is omitted and `inject: true`, injects only (no judge) |
| `moderation` | request / response / both (or omitted for inject-only) | `modelId` (optional for inject-only), `fallbackModelIds?: string[]`, `threshold?: number` (default 0.5), `systemPrompt?: string` | LLM judge: block harmful content (hate, violence, sexual, self-harm); fallback judges tried in order if primary fails. When `target` is omitted and `inject: true`, injects only (no judge) |

**Rule fields:**
- `enabled?: boolean`: default true when absent; when false, the rule is skipped
- `target?: 'request' | 'response' | 'both'`: which side(s) the judge evaluates. Required for regex/semantic. Optional for topic/moderation (omit to enable inject-only). When set, a judge model is required (`config.modelId`).
- `inject?: boolean`: (topic/moderation only) append this rule's instruction to the request system prompt. Independent of `target`. When true on a topic/moderation rule, the rule steers the model without calling the judge (soft enforcement).
- `block?: boolean`: auto-managed when `target` is set (always true for judged rules); accepted on input for backward compatibility but ignored.
- `log?: boolean`: auto-managed when `target` is set (always true for judged rules); accepted on input for backward compatibility but ignored.
- `blockMessage?: string`: the block message now comes from the judge's `reason` field. This field is still accepted on input for backward compatibility but is no longer surfaced by the dashboard or CLI.
- `useJudgeResponse?: boolean`: auto-managed (always true for judged rules); accepted on input for backward compatibility but ignored.

**Fallback models (topic/moderation/semantic only):**
- `fallbackModelIds?: string[]`: ordered list of model IDs to try if the primary model is unavailable or returns an error (other than budget/usage exceeded). Fallbacks are tried in order. If a model returns a usage or budget-exceeded error, the rule fails immediately without trying further fallbacks (fail-closed on budget).

**Judge scoring (topic/moderation with judge):**
- The judge responds with `{"reason": "<explanation>", "score": <0.00-10.00>}`. The reason is in the user's language and becomes the block message. The score (0.00-10.00) is normalized to 0-1 before threshold comparison. Topic rules trigger when normalized score < threshold (off-topic); moderation rules trigger when normalized score > threshold (harmful).

**detectInjection flag:**
- When `true`, run a built-in prompt-injection detector on every request before rule evaluation. A hit blocks and is logged. Injection detection does not support custom messages.

**Target values:** `request` evaluates the user messages; `response` evaluates the model output; `both` evaluates both sides; omitted (for topic/moderation) skips the judge entirely when `inject: true`.

**Streaming interaction:** When any enabled rule has `target` as `response` or `both` (judge on response), the entire response must be buffered before the block decision is made. In this case, streaming is disabled for the request, and the client receives the full response as a single chunk.

#### PII

```json
{
  "pii": {
    "policies": [
      {
        "enabled": true,
        "target": "both",
        "entities": ["EMAIL", "PHONE", "CREDIT_CARD", "SSN", "IBAN"],
        "outputBufferSize": 30
      },
      {
        "enabled": true,
        "target": "request",
        "entities": ["EMAIL", "PHONE"],
        "customPatterns": ["\\b[A-Z]{2}[0-9]{6,8}\\b"]
      }
    ]
  }
}
```

PII configuration contains a list of policies. All enabled policies are merged per-direction
at scrub time (request scrubbing merges policies with `target: request` or `target: both`;
response scrubbing merges policies with `target: response` or `target: both`).

**Policy fields:**
- `enabled?: boolean`: default true when absent; when false, this policy is skipped
- `target: 'request' | 'response' | 'both'`: which side(s) to scrub
- `entities?: PiiEntity[]`: entity types to detect (EMAIL, PHONE, CREDIT_CARD, SSN, IBAN). Defaults to all types when omitted.
- `customPatterns?: string[]`: additional regex patterns to scrub (case-insensitive)
- `outputBufferSize?: number`: (response scrubbing only) suffix buffer size in characters (10-500, default 30). Used to catch patterns spanning chunk boundaries when streaming. When multiple response policies are active, the largest value wins.

Matched values in message content are replaced with typed placeholders (`[EMAIL]`, `[PHONE_NUMBER]`, `[CREDIT_CARD]`, `[SSN]`, `[IBAN]`) before the request is forwarded to the provider and before the response is returned to the caller.

When a guardrail triggers or PII is redacted, the usage record gains
`guardrailTriggered` (the rule type) and/or `piiRedacted` (the list of redacted
entity types).

#### Guardrail judge calls and usage attribution

Security rules that call a model (semantic embedding, topic judge, moderation
judge) are tracked as separate usage records with `callType: "guardrail"`. These
records are attributed to the same project and token as the originating request
and are subject to the same budget limits - an over-budget judge call fails
the same as an over-budget completion. The records appear in
`GET /api/usage` alongside completion and routing records and are broken out in
the usage summary (see [Query Usage Records](#query-usage-records)).

#### Consumer Impact

PII scrubbing modifies request content in-flight. The model receives placeholders
instead of original sensitive values and responds based on the modified message.
Disable specific entity types if your application requires the model to see the
original values.

A rule with `block: true` returns a wire-faithful HTTP 200 response when it
triggers. It does **not** return HTTP 400. See [LLM Proxy: Guardrail block wire format](./llm-proxy.md#guardrail-block--wire-format).

A rule with `log: true` (and `block` unset) forwards the request to the model with no
consumer-visible impact; the match is recorded on the usage record for audit purposes.
`block` and `log` are independent, so a rule may do both: block the request and record the match.

### Optimizers (project field) {#optimizers-project-field}

A project may carry an optional `optimizers` block, accepted by both
`POST /api/projects` and `PUT /api/projects/:slug`. On `PUT`, the field
follows the same undefined/null/object convention as `guardrails` and `pii`:
omit it to leave the pipeline unchanged, send `null` to clear it, or send an
object to validate and replace it. Setting or clearing it requires
`optimizers:manage` **in addition to** `project:write`. A caller with
`project:write` but not `optimizers:manage` gets `403` on any request whose
body includes a non-`undefined` `optimizers` field, even if every other
field is otherwise valid.

```json
{
  "optimizers": {
    "steps": [
      { "id": "session-dedup", "enabled": true },
      { "id": "ccr", "enabled": true },
      { "id": "caveman", "enabled": true },
      { "id": "relevance", "enabled": true, "threshold": 0.3 }
    ]
  }
}
```

**Fields:**
- `steps`: array of optimizer steps. Array order is execution order, steps
  run top to bottom in the `request.preprocess` pipeline phase (required,
  may be empty)
- Each step: `id` (one of `session-dedup`, `ccr`, `rtk`, `headroom`,
  `relevance`, `caveman`, `llmlingua-2`; each id may appear at most once, and
  a duplicate id is rejected), `enabled: boolean`, `threshold?: number`
  (optional; a positive number, capped at `1` for `relevance` and
  `llmlingua-2`, unbounded for `ccr` and `headroom`; unused for
  `session-dedup`, `rtk` and `caveman`)

See [Concepts: Optimizers](../concepts/optimizers.md) for what each id does
and its class. See [Concepts: Optimizers, Threshold
Range](../concepts/optimizers.md#threshold-range) for what each id's
threshold means (`ccr`: turn count, default 6; `headroom`: reserved token
budget, default 1024; `relevance` and `llmlingua-2`: a `0`–`1` ratio; the
rest unused). Leave threshold unset to use the built-in default.

**Errors**: `400` invalid `optimizers` config (bad shape, out-of-range
threshold, or duplicate step id) · `403` insufficient permissions
(`optimizers:manage` required to set/clear)

### Delete Project

```
DELETE /api/projects/:slug
```

---

## Project Tokens

### List Tokens

```
GET /api/projects/:slug/tokens
```

### Create Token

```
POST /api/projects/:slug/tokens
```

```json
{
  "name": "production",
  "labels": ["prod"],
  "scopes": ["batch", "internal"],
  "tags": {
    "environment": "prod",
    "team": "backend"
  },
  "limits": [
    {
      "metric": "cost",
      "limit": 10.00,
      "window": "monthly",
      "mode": "extend"
    }
  ]
}
```

**Fields:**
- `name` - token name (required)
- `labels`: array of free-text labels shown next to the token in the dashboard (optional)
- `scopes`: free-form scopes stored with the token (optional). Routerly does
  not interpret them; they are yours for bookkeeping. The MCP server is
  authenticated by [personal MCP tokens](#personal-mcp-surface), not by these
  scopes
- `tags` - arbitrary key-value metadata attached to the token (optional). Tags are included in every usage record created with this token.
- `limits` - array of per-token spending limits (optional)

**Response includes the token value in plain text - returned once only.** The response also includes the `labels`, `scopes`, and `tags` fields.

### Update Token

```
PUT /api/projects/:slug/tokens/:tokenId
```

```json
{
  "scopes": ["batch"],
  "tags": {
    "environment": "staging"
  }
}
```

**Fields:**
- `labels`: replace the token's labels (optional)
- `scopes`: replace the token's access scopes (optional)
- `tags` - replace the token's tags. Pass an empty object `{}` to clear all tags (optional).

Any field omitted from the request body is left unchanged (partial update).

### Delete Token

```
DELETE /api/projects/:slug/tokens/:tokenId
```

---

## Project Members

### List Members

```
GET /api/projects/:slug/members
```

### Add Member

```
POST /api/projects/:slug/members
```

```json
{ "userId": "user-uuid", "role": "viewer" }
```

### Update Member Role

```
PUT /api/projects/:slug/members/:userId
```

```json
{ "role": "editor" }
```

### Remove Member

```
DELETE /api/projects/:slug/members/:userId
```

---

## Users

### List Users

```
GET /api/users
```

### Create User

```
POST /api/users
```

```json
{ "email": "user@example.com", "password": "password", "role": "operator" }
```

### Get User

```
GET /api/users/:id
```

### Update User

```
PUT /api/users/:id
```

### Delete User

```
DELETE /api/users/:id
```

---

## Roles

### List Roles

```
GET /api/roles
```

### Create Role

```
POST /api/roles
```

```json
{
  "name": "billing_reviewer",
  "permissions": ["project:read", "report:read"]
}
```

### Update Role

```
PUT /api/roles/:name
```

### Delete Role

```
DELETE /api/roles/:name
```

---

## Spend Groups

Org- and team-level budget containers for the hierarchical spend-limit cascade
(organisation -> team -> API key). A project belongs to a group via its
`spendGroupId`; groups may nest via `parentGroupId`. When a request runs through
a project that belongs to a group, the group chain's limits are enforced in
addition to the per-model/project/token limits. Child limits cannot exceed
parent limits (validated on create/update).

A group object:

```json
{
  "id": "uuid",
  "name": "Engineering",
  "limits": [{ "metric": "cost", "windowType": "period", "period": "monthly", "value": 1000 }],
  "projectIds": ["proj-1"],
  "tokenIds": [],
  "parentGroupId": "org-uuid"
}
```

### List Spend Groups

```
GET /api/spend-groups
```

Requires `report:read`. Returns each group with a `usage` array (current and
remaining consumption per limit, aggregating its own and descendant groups'
projects) for the consumption tree view and end-of-period forecast.

### Create Spend Group

```
POST /api/spend-groups
```

Requires `project:write`. Body validated with Zod (`name` required; `limits`,
`projectIds`, `tokenIds`, `parentGroupId` optional). Returns `400` if a child
limit exceeds the parent's matching limit or the parent does not exist.

### Update Spend Group

```
PUT /api/spend-groups/:id
```

Requires `project:write`. Same validation as create. A group cannot be its own
parent.

### Delete Spend Group

```
DELETE /api/spend-groups/:id
```

Requires `project:write`. Returns `409` if the group still has child groups.

---

## Usage {#usage}

### Query Usage Records

```
GET /api/usage
```

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO date | Start of range |
| `to` | ISO date | End of range |
| `project` | string | Filter by project slug |
| `projectIds` | string | Comma-separated project IDs to filter by |
| `model` | string | Filter by model ID |
| `modelIds` | string | Comma-separated model IDs to filter by |
| `callType` | string | Who made the call: `completion` (the client), `routing`, or `guardrail`. `completion` also matches legacy records with no `callType` field |
| `requestType` | string | What was asked for, from the endpoint the client hit: `chat`, `completion`, `embedding`, `rerank`, `image`, `audio`. `chat` also matches records written before 0.4.0, which had no `requestType` field |
| `outcome` | string | `success`, `error`, `budget_exceeded`, `timeout`, `blocked`. `error` matches records that are neither `success` nor `blocked` |
| `limit` | number | Max records to return (default: 100) |
| `offset` | number | Pagination offset |
| `savings` | string | `1` adds the [savings block](#savings-block) to the response. Off by default: the computation is only paid for by the callers that show it |

`callType` and `requestType` are two different questions about the same record. A semantic-intent embedding fired by the router is `callType: "routing"`, `requestType: "embedding"`; a plain chat request from a client is `callType: "completion"`, `requestType: "chat"`. Calls the gateway forwards through the pass-through proxy (embeddings, images, audio) are recorded with their `requestType` and zero tokens, since their body is streamed to the client rather than parsed.

All filters are applied server-side. `projectIds` and `modelIds` accept comma-separated values for multi-value filtering; they combine with (AND) the single-value `project` and `model` parameters when both are provided, narrowing the result to records that match every active filter.

**Response summary object:**

```json
{
  "summary": {
    "totalCost": 0.1234,
    "totalCalls": 200,
    "successCalls": 188,
    "blockedCalls": 3,
    "errorCalls": 9,
    "completionCalls": 180,
    "routingCalls": 8,
    "guardrailCalls": 12,
    "completionCost": 0.1200,
    "routingCost": 0.0011,
    "guardrailCost": 0.0023
  },
  "byModel": {
    "openai/gpt-5-mini": {
      "calls": 120,
      "cost": 0.08,
      "success": 115,
      "avgLatencyMs": 820,
      "p95LatencyMs": 1540
    }
  },
  "timeline": [],
  "records": [],
  "pagination": {}
}
```

The `summary` object breaks down calls and cost by sub-activity type:

| Field | Description |
|-------|-------------|
| `completionCalls` / `completionCost` | Main model inference calls |
| `routingCalls` / `routingCost` | LLM policy routing calls (e.g. the `llm` routing policy) |
| `guardrailCalls` / `guardrailCost` | Model calls made by security rules (semantic embedding, topic judge, moderation judge) |
| `blockedCalls` | Requests blocked by a guardrail rule before reaching any model |
| `errorCalls` | Failed calls -- does **not** include blocked calls |

Each `byModel` entry includes:

| Field | Description |
|-------|-------------|
| `calls` | Total requests for this model in the period |
| `cost` | Total cost in USD |
| `success` | Number of successful calls |
| `avgLatencyMs` | Mean response time in milliseconds |
| `p95LatencyMs` | 95th-percentile response time in milliseconds |

Guardrail judge call records appear in the `records` array with `callType: "guardrail"`. Blocked request records appear with `outcome: "blocked"` and `callType: "guardrail"`. The `errorCalls` counter excludes blocked requests -- a block is a normal guardrail outcome, not a model error.

The `outcome` filter on `GET /api/usage` accepts `blocked` in addition to `success`, `error`, and `budget_exceeded`.

### Savings block

Add `savings=1` to `GET /api/usage` to get a `savings` object alongside the rest of the response. It answers two questions over the same filtered records: what the routed traffic actually cost and took, and what it would have cost and taken had every client call gone to one fixed model instead.

```json
{
  "savings": {
    "comparedCalls": 180,
    "comparedCost": 0.12,
    "comparedLatencyMs": 148000,
    "comparedInputTokens": 420000,
    "comparedOutputTokens": 96000,
    "cache": { "inputTokens": 180000, "cost": 0.0162 },
    "baselines": [
      {
        "modelId": "openai/gpt-5-mini",
        "cost": 0.14,
        "costDelta": 0.02,
        "costDeltaPercent": 14.28,
        "latencyMs": 132000,
        "latencyDeltaMs": -16000,
        "latencySamples": 120
      }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `comparedCalls` | Client calls the counterfactual covers: successful, carrying tokens, priced against a known model |
| `comparedCost` | What those calls actually cost, in USD |
| `comparedLatencyMs` | What those calls actually took, in milliseconds, summed |
| `comparedInputTokens` / `comparedOutputTokens` | Token totals of the compared calls |
| `cache.inputTokens` | Input tokens served from prompt cache instead of being charged at full input price |
| `cache.cost` | USD those cached tokens saved against the same model's full input price |
| `baselines` | One counterfactual per baseline model, cheapest first |

Each baseline entry:

| Field | Description |
|-------|-------------|
| `modelId` | The baseline model |
| `cost` | The compared calls repriced at this model's rates, in USD |
| `costDelta` | `comparedCost - cost`. Positive means routing came out cheaper than this baseline |
| `costDeltaPercent` | `costDelta` as a percentage of the baseline cost |
| `latencyMs` | Estimated total time, from this model's own median milliseconds per output token over the same window. Absent when the model produced no output token in the window |
| `latencyDeltaMs` | `comparedLatencyMs - latencyMs`. Positive means routing came out faster. Absent together with `latencyMs` |
| `latencySamples` | Calls of this model in the window backing the time estimate. `0` means there is no estimate, only the cost figure |

Baselines are the enabled target models of every project present in the filtered result, so a query scoped with `projectId` counterfactuals exactly that project's targets, and an unscoped query counterfactuals every target model in use.

Routing and guardrail calls are excluded from the comparison: they are the gateway's own overhead, not the client's workload, and the `summary` object already reports them. Pass-through records carry no tokens and are excluded for the same reason.

:::note Repricing is an estimate, not a replay
The cost figure is exact arithmetic on the observed token counts, but a different model tokenizes the same text slightly differently and may answer at a different length. Read a baseline as "the same conversation, priced elsewhere". Measuring the real difference needs a live comparison on production traffic.
:::

### Get a Single Usage Record

```
GET /api/usage/:id
```

Requires `report:read`. Returns the full usage record.

`:id` is matched against the record id first, then against its `traceId`. That second lookup is what makes a notification carrying only a trace id link straight to the request that produced it.

**Errors**: `404` record not found · `403` missing `report:read`

Individual usage records for blocked requests carry `guardrailTriggered` (the rule identifier, e.g. `regex:pattern` or `injection:dan-mode`) and `blockedBy` (same value; present only when the outcome is `blocked`). Records where PII was redacted carry `piiRedacted` with an array of redacted entity types. Records where a guardrail triggered on the `flag` or `log` path carry `guardrailTriggered` but not `blockedBy`.

:::note Wire format unchanged
The block response sent to the API client is standard and unchanged: HTTP 200, empty content, `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic). Only observability around the block changed - the usage record is now written and the summary counts it separately.
:::

### Get Routing Trace

```
GET /api/traces/:id
```

Returns the routing trace (`{ trace: [...] }`). All trace entries are stored out-of-band in the trace store; the wire response sent to your API client is never modified.

| Entry | When emitted | `details` shape |
|-------|-------------|-----------------|
| `guardrail:evaluated` | After every guardrail check on each target, whether or not any rule fires | `{ target: "request"\|"response", rules: [{ rule, outcome, reason? }] }`. One object per rule. `outcome` is `passed`, `triggered`, or `skipped`. `reason` is set on skipped rules (e.g. `judge-failed`) and on scoring rules (e.g. `regex:<pattern>`, `semantic:82%`). The built-in prompt-injection check appears as `rule: "injection"`. |
| `guardrail:triggered` | Emitted whenever a rule triggers (block or log) on the request side | `{ rule, target, block, log, blockMessage }` |
| `guardrail:response-triggered` | Emitted whenever a rule triggers (block or log) on the response side | `{ rule, target, block, log, blockMessage }` |
| `pii:evaluated` | After every PII scrubbing pass, whether or not anything was redacted | `{ redacted: string[] }`. Entity types found (e.g. `["EMAIL"]`). Empty array on a clean pass. `panel` indicates `"request"` or `"response"`. |
| `pii:scrubbed` | When at least one PII entity was detected and replaced | `{ entities: string[] }`. Entity types that were replaced. Also emitted alongside `pii:evaluated` on a hit. |

Use the `x-routerly-trace-id` header from any LLM proxy response - present even on blocked responses - to look up its trace:

```bash
curl -s http://localhost:3000/api/traces/$TRACE_ID \
  -H "Authorization: Bearer <jwt>"
```

---

## End Users

### List End Users

```
GET /api/end-users
```

**Auth**: `Authorization: Bearer <jwt>` (requires `report:read`)

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Filter by project ID (optional) |

**Response `200`:**

```json
{
  "users": [
    {
      "userId": "user-123",
      "projectId": "proj-uuid",
      "firstSeen": "2026-06-15T10:30:00.000Z",
      "lastSeen": "2026-06-25T14:45:30.000Z",
      "requests": 142,
      "totalTokens": 45600,
      "totalCost": 0.0456
    }
  ]
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | End-user identifier (from `body.user` in the request) |
| `projectId` | string | Project ID this user is attributed to |
| `firstSeen` | ISO 8601 | Timestamp of first request |
| `lastSeen` | ISO 8601 | Timestamp of most recent request |
| `requests` | number | Total request count for this user |
| `totalTokens` | number | Total tokens used (input + output) |
| `totalCost` | number | Estimated USD cost |

**Errors**: `403` insufficient permissions

---

## Settings

### Get Settings

```
GET /api/settings
```

**Response `200`:**
```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "logLevel": "info",
  "publicUrl": "https://routerly.example.com",
  "requireMfa": false,
  "listeningAddresses": ["http://127.0.0.1:3000", "http://192.168.1.116:3000"],
  "localAddresses": ["192.168.1.116"],
  "providerRepos": [
    {
      "url": "https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/",
      "enabled": true,
      "channel": null
    }
  ]
}
```

`listeningAddresses` and `localAddresses` are derived at runtime from the bind host and are not stored in `settings.json`: a wildcard bind expands to every IPv4 interface, any other host resolves to that single address. They are read-only and ignored on `PUT`.

### Update Settings

```
PUT /api/settings
```

```json
{
  "port": 3000,
  "logLevel": "info",
  "publicUrl": "https://routerly.example.com",
  "providerRepos": [
    {
      "url": "https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/",
      "enabled": true
    },
    {
      "url": "https://your-org.com/catalog/",
      "enabled": true
    }
  ]
}
```

**Fields:**
- `port`, `logLevel`, `publicUrl`, `requireMfa` - service configuration (optional)
- `providerRepos` - array of provider repository objects (optional)

**ProviderRepo object:**
- `url` - repository endpoint (required)
- `enabled` - whether the repo is active (optional, default `true`)
- `channel` - named channel to prefer (optional, e.g. `stable`, `latest`)

---

## Modules

Manage optional service modules. Core modules (`config`, `provider`, `catalog`, `reverse-proxy`, `routing`) are always-on and cannot be disabled. Optional modules (e.g. `guardrails`, `pii`) can be toggled on or off; disabling a module removes its features entirely at boot (no hot-swap). Changes require a service restart.

### List Modules

```
GET /api/modules
```

**Auth**: `Authorization: Bearer <jwt>` (requires `modules:read`)

**Response `200`:**
```json
[
  {
    "id": "guardrails",
    "version": "0.4.0",
    "enabled": true,
    "alwaysOn": false,
    "dependsOn": []
  },
  {
    "id": "reverse-proxy",
    "version": "0.4.0",
    "enabled": true,
    "alwaysOn": true,
    "dependsOn": ["provider", "routing"]
  }
]
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Module identifier |
| `version` | string | Module semantic version |
| `enabled` | boolean | Whether the module is currently active. When a module is disabled, its routes, tools, and features are not loaded at boot; disabling requires a service restart to take effect |
| `alwaysOn` | boolean | Whether this is a core module that cannot be disabled |
| `dependsOn` | array | List of module IDs this module depends on; empty array if no dependencies |

**Errors**: `403` insufficient permissions

### Enable Module

```
POST /api/modules/:id/enable
```

**Auth**: `Authorization: Bearer <jwt>` (requires `modules:manage`)

Enables a module. Returns `409` if the module is unknown or has unmet dependencies. Always-on modules are already enabled by definition and can be targeted here without error (no-op, returns `200`).

**Response `200`:**
```json
{
  "id": "guardrails",
  "enabled": true,
  "restartRequired": true
}
```

**Response `409` (unknown module):**
```json
{ "error": "Unknown module \"unknown-module\"" }
```

**Response `409` (unmet dependencies):**
```json
{ "error": "Cannot enable \"guardrails\": depends on disabled provider" }
```

**Errors**: `403` insufficient permissions · `409` module cannot be enabled

### Disable Module

```
POST /api/modules/:id/disable
```

**Auth**: `Authorization: Bearer <jwt>` (requires `modules:manage`)

Disables a module. Returns `409` if the module is always-on, unknown, or required by another enabled module.

**Response `200`:**
```json
{
  "id": "guardrails",
  "enabled": false,
  "restartRequired": true
}
```

**Response `409` (always-on):**
```json
{ "error": "Module \"reverse-proxy\" is always-on and cannot be disabled" }
```

**Response `409` (unknown module):**
```json
{ "error": "Unknown module \"unknown-module\"" }
```

**Response `409` (required by dependents):**
```json
{ "error": "Cannot disable \"provider\": required by reverse-proxy, routing" }
```

**Errors**: `403` insufficient permissions · `409` module cannot be disabled

---

## Catalog

Manage provider and model catalog repositories and cache.

### Get Provider Catalog

```
GET /api/providers
```

**Auth**: `Authorization: Bearer <jwt>` (requires `model:read`)

Returns the full provider catalog fetched from configured repositories.

**Response `200`:**
```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "models": [
        {
          "id": "gpt-5.2",
          "name": "GPT-5.2",
          "contextWindow": 128000,
          "inputPrice": 1.75,
          "outputPrice": 14.0,
          "capabilities": ["functionCalling", "json", "vision"]
        }
      ]
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "models": [
        {
          "id": "claude-opus-4-6",
          "name": "Claude Opus 4.6",
          "contextWindow": 200000,
          "inputPrice": 5.0,
          "outputPrice": 25.0,
          "capabilities": ["functionCalling", "json"]
        }
      ]
    }
  ]
}
```

**Errors**: `403` insufficient permissions

### Get Catalog Status

```
GET /api/catalog/status
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:read`)

Returns per-repository status information.

**Response `200`:**
```json
{
  "repos": [
    {
      "url": "https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/",
      "enabled": true,
      "resolvedFile": "providers/providers.20260630120000.json",
      "updatedAt": "2026-06-30T12:00:00.000Z",
      "lastChecked": "2026-06-30T14:30:00.000Z",
      "error": null
    },
    {
      "url": "https://your-org.com/catalog/",
      "enabled": true,
      "resolvedFile": null,
      "updatedAt": null,
      "lastChecked": "2026-06-30T14:30:00.000Z",
      "error": "HTTP 404: Not Found"
    }
  ],
  "cachedAt": "2026-06-30T14:30:00.000Z",
  "expiresAt": "2026-06-30T14:35:00.000Z"
}
```

**Fields:**
- `url` - repository endpoint
- `enabled` - whether this repo is active
- `resolvedFile` - filename of the last successfully fetched catalog (null if never fetched)
- `updatedAt` - timestamp from the catalog registry (null if never fetched)
- `lastChecked` - when Routerly last attempted to fetch from this repo
- `error` - error message if the last fetch failed (null on success)
- `cachedAt` - when the current catalog was loaded into memory
- `expiresAt` - when the 5-minute cache expires

**Errors**: `403` insufficient permissions

### Refresh Catalog Cache

```
POST /api/catalog/refresh
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:write`)

Invalidate the in-memory cache and fetch all enabled repositories immediately.

**Response `200`:**
```json
{ "ok": true, "message": "Catalog refreshed successfully" }
```

**Response `200` (partial failure - some repos errored):**
```json
{
  "ok": false,
  "message": "Catalog refresh completed with errors",
  "errors": [
    {
      "url": "https://your-org.com/catalog/",
      "error": "HTTP 404: Not Found"
    }
  ]
}
```

**Errors**: `403` insufficient permissions

---

## Notifications {#notification-channels}

### List Channels

```
GET /api/notifications/channels
```

**Auth**: `Authorization: Bearer <jwt>` (requires `user:write`)

Returns the configured notification channels array.

### Create Channel

```
POST /api/notifications/channels
```

**Auth**: `Authorization: Bearer <jwt>` (requires `user:write`)

**Request body**
```json
{
  "provider": "dashboard",
  "name": "Budget Alerts",
  "events": ["budget.*"],
  "targets": {
    "roles": ["admin"],
    "permissions": [],
    "users": ["user-uuid"]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | yes | Channel type: `smtp`, `ses`, `sendgrid`, `azure`, `google`, `webhook`, `slack`, `teams`, `pagerduty`, `discord`, `dashboard` |
| `name` | string | no | Friendly label shown in the UI |
| `events` | string[] | no | Event patterns routed to this channel (empty = all). Supports exact names, `*`, and prefix globs like `budget.*` |
| `targets` | object | no | `{ roles, permissions, users }` - who receives (empty = everyone). Controls inbox visibility for `dashboard` and recipient resolution for email channels; ignored for webhook/native channels |

Provider-specific fields (e.g. `host`, `apiKey`, `botToken`) pass through alongside these base fields.

**Response `201`**
```json
{
  "id": "abc-uuid",
  "provider": "dashboard",
  "name": "Budget Alerts",
  "events": ["budget.*"],
  "targets": { "roles": ["admin"] }
}
```

**Errors**: `400` invalid body (unknown provider, bad targets shape) · `403` insufficient permissions

### Delete Channel

```
DELETE /api/notifications/channels/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `user:write`)

**Response**: `204 No Content`

**Errors**: `404` channel not found · `403` insufficient permissions

### Get Channel

```
GET /api/notifications/channels/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `user:write`)

**Response `200`**
```json
{
  "id": "abc-uuid",
  "provider": "smtp",
  "name": "Admin Alerts",
  "host": "smtp.example.com",
  "port": 587,
  "fromAddress": "alerts@example.com",
  "fromName": "Routerly",
  "events": ["provider.error", "budget.exhausted"],
  "targets": { "roles": ["admin"] }
}
```

Secrets (API keys, passwords, tokens) are masked and shown as `null` when present in the channel config.

**Errors**: `404` channel not found · `403` insufficient permissions

### Update Channel

```
PATCH /api/notifications/channels/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `user:write`)

**Request body** (all fields optional):
```json
{
  "name": "Updated Name",
  "events": ["budget.*"],
  "targets": { "roles": ["admin"], "permissions": [], "users": [] },
  "host": "new-smtp.example.com",
  "port": 587,
  "password": "new_secret_password",
  "apiKey": "new_api_key"
}
```

- To **clear event filters**, send an empty array: `"events": []`
- To **clear targets**, send an empty object: `"targets": {}`
- **Secret fields** (passwords, API keys, tokens) are only updated when explicitly provided and non-empty. Omitting a secret field leaves it unchanged.

**Response `200`**
```json
{
  "id": "abc-uuid",
  "provider": "smtp",
  "name": "Updated Name",
  "host": "new-smtp.example.com",
  "port": 587,
  "fromAddress": "alerts@example.com",
  "events": ["budget.*"],
  "targets": { "roles": ["admin"] }
}
```

**Errors**: `404` channel not found · `400` invalid body · `403` insufficient permissions

### Test Channel

```
POST /api/notifications/channels/:id/test
```

**Auth**: `Authorization: Bearer <jwt>` (requires `user:write`)

**Request body** (optional)
```json
{ "to": "override-recipient@example.com" }
```

**Response `200`**
```json
{ "ok": true, "message": "Test notification sent" }
```

**Errors**: `404` channel not found · `400` send failed (details in `message`)

### Notifications Inbox {#notifications-inbox}

The in-app notification inbox is per-user, available to any authenticated dashboard user (no special permission required). Three gates decide whether an item reaches the caller:

1. **Audience** - the `targets` of the `dashboard` channel that created the item; no targeting means everyone.
2. **Permissions** - `auth.*` events need `audit:read`, `config.model_*` needs `model:read`, `config.project_*` needs `project:read`, `system.*` needs `settings:read`. Routing, provider and budget events are not gated.
3. **Projects** - an item whose `details.projectId` points at a project the caller cannot reach (by `projectIds` scope or membership) is hidden. Callers without a project scope see every project.

Users can also dismiss items individually (soft delete), which removes them from their personal inbox only.

#### List Inbox Items

```
GET /api/notifications/inbox?limit=50&page=1&pageSize=20&severity=all&category=&event=&unreadOnly=false&from=&to=
```

**Query params:**
- `limit` - max items in legacy flat-list response (1–200, default 50). When `page` is omitted, activates flat-list mode; presence of `page` switches to paginated mode.
- `page` - page number for paginated response (1-indexed, default 1)
- `pageSize` - items per page (1–100, default 20)
- `severity` - filter by severity: `info`, `warning`, `critical`, or `all` (default `all`)
- `category` - filter by event category: `routing`, `provider`, `budget`, `config`, `security`, `system`. Omit for all categories
- `event` - filter by event name substring (case-insensitive)
- `unreadOnly` - when `true`, returns only items the current user has not read
- `from` - start date (YYYY-MM-DD or ISO 8601 timestamp); when date-only, spans from 00:00
- `to` - end date (YYYY-MM-DD or ISO 8601 timestamp); when date-only, spans to 23:59:59

**Response `200` (flat-list mode when `page` omitted):**
```json
{
  "items": [
    {
      "id": "8f3c…",
      "event": "provider.error",
      "severity": "critical",
      "timestamp": "2026-06-24T12:00:00.000Z",
      "details": { "modelId": "openai/gpt-4o", "traceId": "e7b1…" },
      "read": false,
      "traceId": "e7b1…",
      "eventCount": 3
    }
  ],
  "unreadCount": 5,
  "enabled": true
}
```

Events emitted while serving the same request share a trace id and are folded into a single item: `traceId` carries that id and `eventCount` how many events it represents. `eventCount` is omitted when the item stands alone. The list never carries the folded sequence - fetch the item to get it.

**Response `200` (paginated mode when `page` is provided):**
```json
{
  "items": [ /* … */ ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalRecords": 127,
    "totalPages": 7
  },
  "unreadCount": 5,
  "enabled": true
}
```

- `items` - notifications newest-first
- `unreadCount` - total unread count for the current user (independent of filters)
- `enabled` - `true` when at least one `dashboard`-provider channel is configured; `false` when the inbox is not yet initialized
- `pagination` - only in paginated mode (when `page` query param is present)

#### Get Single Notification

```
GET /api/notifications/inbox/:id
```

**Response `200`:**
```json
{
  "id": "8f3c…",
  "event": "provider.error",
  "severity": "critical",
  "timestamp": "2026-06-24T12:00:00.000Z",
  "details": { "modelId": "openai/gpt-4o", "latencyMs": 5000, "traceId": "e7b1…" },
  "read": false,
  "traceId": "e7b1…",
  "eventCount": 2,
  "events": [
    {
      "event": "routing.fallback_used",
      "severity": "info",
      "timestamp": "2026-06-24T11:59:58.000Z",
      "details": { "primaryModelId": "openai/gpt-4o", "fallbackModelId": "ollama/qwen2.5:3b" }
    },
    {
      "event": "provider.error",
      "severity": "critical",
      "timestamp": "2026-06-24T12:00:00.000Z",
      "details": { "modelId": "openai/gpt-4o", "latencyMs": 5000 }
    }
  ]
}
```

- `eventCount` - number of events folded into this item; `1` for a lone event
- `events` - the incident's sequence, oldest first. Present only when a second event correlated on the same `traceId`. The top-level `event`, `severity` and `details` mirror the most severe entry
- Only this endpoint returns `events`; the list endpoint stops at `traceId` and `eventCount`

**Errors**: `404` notification not found (does not exist, is not in the current user's inbox, or the caller lacks the permission or project scope the item requires)

#### Mark Inbox Items as Read

```
POST /api/notifications/inbox/read
```

Marks inbox items as read for the current user. Provide either `ids` or `all`:

```json
{ "ids": ["8f3c…", "1a2b…"] }
```
```json
{ "all": true }
```

Returns `400` if neither is provided.

**Response `200`:**
```json
{ "updated": 2 }
```

All read operations are logged to the audit log as `notification:read` actions.

#### Mark Inbox Items as Unread

```
POST /api/notifications/inbox/unread
```

Clears the current user's read mark on one or more notifications. Inverse of `/read`. Provide either `ids` or `all`:

```json
{ "ids": ["8f3c…"] }
```
```json
{ "all": true }
```

Returns `400` if neither is provided.

**Response `200`:**
```json
{ "updated": 1 }
```

All unread operations are logged to the audit log as `notification:unread` actions.

#### Delete (Dismiss) Inbox Items

```
POST /api/notifications/inbox/delete
```

Dismisses (soft-deletes) one or more items from the current user's inbox only. Other users' copies of the same notification remain unaffected. Provide either `ids` or `all`:

```json
{ "ids": ["8f3c…", "1a2b…"] }
```
```json
{ "all": true }
```

Returns `400` if neither is provided.

**Response `200`:**
```json
{ "deleted": 2 }
```

**Important:** Deletion is **per-user only**. Global deletion is never performed. All delete operations are logged to the audit log as `notification:delete` actions.

### Test (legacy endpoint)

```
POST /api/notifications/test
```

```json
{ "channelId": "abc-uuid" }
```

Returns `200 OK` on success or an error with details. Prefer `POST /api/notifications/channels/:id/test`.

---

## Integrations

Export Routerly metrics to external monitoring systems (Prometheus, OpenTelemetry, Datadog, Grafana Cloud, InfluxDB, Webhooks).

### List Integrations

```
GET /api/integrations
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:write`)

**Response `200`**
```json
{
  "integrations": [
    {
      "id": "int-uuid",
      "type": "prometheus",
      "enabled": true,
      "name": "Prometheus",
      "authToken": null
    },
    {
      "id": "int-uuid2",
      "type": "otel",
      "enabled": true,
      "name": "OpenTelemetry",
      "endpoint": "http://localhost:4318/v1/metrics",
      "protocol": "http",
      "headers": {}
    }
  ]
}
```

Secret fields (authToken, apiKey, token, secret) are masked and shown as `null` when present.

**Errors**: `403` insufficient permissions

### Get Integration

```
GET /api/integrations/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:write`)

**Response `200`** (example: Datadog integration)
```json
{
  "id": "int-uuid",
  "type": "datadog",
  "enabled": true,
  "name": "Datadog Production",
  "apiKey": null,
  "site": "datadoghq.com"
}
```

Secret fields are masked and shown as `null` when present.

**Errors**: `404` integration not found · `403` insufficient permissions

### Create Integration

```
POST /api/integrations
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:write`)

**Request body** - per-type examples:

**Prometheus** (pull, optional auth)
```json
{
  "type": "prometheus",
  "name": "Prometheus",
  "authToken": "secret-token-123"
}
```

**OpenTelemetry** (push)
```json
{
  "type": "otel",
  "name": "OpenTelemetry Collector",
  "endpoint": "http://localhost:4318/v1/metrics",
  "protocol": "http",
  "headers": {
    "Authorization": "Bearer otel-token"
  }
}
```

**Datadog** (push)
```json
{
  "type": "datadog",
  "name": "Datadog",
  "apiKey": "dd_api_key_123",
  "site": "datadoghq.com"
}
```

Site options: `datadoghq.com` (US East), `datadoghq.eu` (EU), `us3.datadoghq.com`, `us5.datadoghq.com`, `ddog-gov.com` (GovCloud).

**Grafana Cloud** (push, Prometheus remote_write)
```json
{
  "type": "grafana",
  "name": "Grafana Cloud",
  "url": "https://prometheus-blocks-prod-us-central1.grafana.net/api/prom/push",
  "username": "123456",
  "apiKey": "glc_api_key_123"
}
```

**InfluxDB** (push, v2)
```json
{
  "type": "influxdb",
  "name": "InfluxDB",
  "url": "http://localhost:8086",
  "token": "my-token",
  "org": "routerly",
  "bucket": "metrics"
}
```

**Webhook** (push)
```json
{
  "type": "webhook",
  "name": "Webhook",
  "url": "https://example.com/metrics",
  "secret": "signing-secret",
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

Webhook requests are signed with HMAC-SHA256 using the `secret` field; the signature is sent in the `X-Routerly-Signature` header (format: `sha256=<hex>`).

**Response `201`**
```json
{
  "id": "int-uuid",
  "type": "otel",
  "enabled": true,
  "name": "OpenTelemetry Collector",
  "endpoint": "http://localhost:4318/v1/metrics",
  "protocol": "http",
  "headers": {}
}
```

**Errors**: `400` invalid body · `403` insufficient permissions

### Update Integration

```
PATCH /api/integrations/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:write`)

**Request body** (all fields optional):
```json
{
  "name": "Updated Name",
  "enabled": false,
  "apiKey": "new-api-key"
}
```

- To enable/disable: set `"enabled": true` or `"enabled": false`
- Secret fields (authToken, apiKey, token, secret) are only updated when explicitly provided and non-empty. Omitting a secret field leaves it unchanged.
- Per-type config fields (endpoint, protocol, url, etc.) can be updated individually

**Response `200`**
```json
{
  "id": "int-uuid",
  "type": "otel",
  "enabled": false,
  "name": "Updated Name",
  "endpoint": "http://localhost:4318/v1/metrics",
  "protocol": "http"
}
```

**Errors**: `404` integration not found · `400` invalid body · `403` insufficient permissions

### Delete Integration

```
DELETE /api/integrations/:id
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:write`)

**Response**: `204 No Content`

**Errors**: `404` integration not found · `403` insufficient permissions

### Test Integration

```
POST /api/integrations/:id/test
```

**Auth**: `Authorization: Bearer <jwt>` (requires `settings:write`)

Tests connectivity to the external system. For Prometheus (pull-based), the test is a no-op (always succeeds). For push-based integrations, sends a real metrics push and returns the result.

**Response `200`**
```json
{ "ok": true, "message": "Connection successful" }
```

**Response `200` (on push failure)**
```json
{ "ok": false, "message": "HTTP 401: Unauthorized" }
```

**Errors**: `404` integration not found · `403` insufficient permissions

### Metrics Pushed

All push-type integrations (OpenTelemetry, Datadog, Grafana, InfluxDB, Webhook) send the following metrics every 60 seconds:

| Metric | Type | Labels/Dimensions | Description |
|--------|------|-------------------|-------------|
| `routerly_requests_total` | Counter | `project`, `model` | Total request count |
| `routerly_tokens_total` | Counter | `type` (input/output), `project`, `model` | Total tokens consumed |
| `routerly_cost_usd_total` | Gauge | `project`, `model` | Estimated USD cost |
| `routerly_request_duration_p50_ms` | Gauge | `project` | Median request latency |
| `routerly_request_duration_p95_ms` | Gauge | `project` | 95th percentile latency |
| `routerly_budget_used_ratio` | Gauge | `project` | Budget consumption (0–1) |

Each integration type sends these metrics in its native format (OTLP, Datadog Series API, Prometheus remote_write, InfluxDB line protocol, JSON webhook).

---

## Audit Log

### List Audit Entries

```
GET /api/audit
```

**Auth**: `Authorization: Bearer <jwt>` (requires `audit:read`)

Returns paginated audit log entries. Requires `audit:read` permission.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Filter by user ID or email (substring match on email) |
| `action` | string | Filter by action substring (e.g. `model:create`) |
| `result` | string | Filter by result: `success`, `forbidden`, or `error` |
| `from` | string | Start timestamp (ISO 8601) |
| `to` | string | End timestamp (ISO 8601) |
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Entries per page (default: 50, max: 200) |

**Response** `200`

```json
{
  "entries": [
    {
      "id": "uuid",
      "timestamp": "2026-06-25T13:03:26.767Z",
      "userId": "uuid",
      "email": "admin@example.com",
      "endpoint": "POST /api/models",
      "action": "model:create",
      "result": "success",
      "details": { "id": "my-model" }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "totalRecords": 142,
    "totalPages": 3
  }
}
```

**Errors**: `403` insufficient permissions

---

## System

### Get System Info

```
GET /api/system/info
```

No authentication required.

**Response:**
```json
{
  "version": "0.2.0",
  "nodeVersion": "v22.0.0",
  "platform": "darwin",
  "configDir": "/Users/you/.routerly/config",
  "dataDir": "/Users/you/.routerly/data",
  "uptimeSeconds": 3600,
  "channel": "stable",
  "isDocker": false,
  "updateInfo": {
    "available": true,
    "currentVersion": "0.2.0",
    "latestVersion": "0.3.0",
    "channel": "stable",
    "releaseUrl": "https://github.com/Inebrio/Routerly/releases/tag/v0.3.0",
    "checkedAt": "2026-06-09T10:00:00.000Z"
  }
}
```

`updateInfo` is `null` if no check has completed yet (first 24 hours after boot). `isDocker` is `true` when the service is running inside a Docker container.

---

### Force Update Check

```
GET /api/system/update-check
```

Requires authentication. Forces an immediate check against the GitHub Releases API and returns the result. This also updates the cached value returned by `GET /api/system/info`.

**Response:** same shape as `updateInfo` above (`UpdateInfo` object).

```json
{
  "available": false,
  "currentVersion": "0.2.0",
  "latestVersion": "0.2.0",
  "channel": "stable",
  "checkedAt": "2026-06-09T12:34:56.000Z"
}
```

---

### Trigger In-App Update

```
POST /api/system/update
```

**Admin only.** Downloads and installs the latest version on the active channel and restarts the service. The response is returned immediately (202); the update runs in the background.

**Constraints:**
- Returns `403` if the caller is not an admin.
- Returns `403` if the service is running inside Docker (`ROUTERLY_DOCKER=1`). Pull the new image instead.
- Returns `400` if the service is running on Windows. Run the installer manually.

**Response `202`:**
```json
{ "message": "Update started. The service will restart shortly." }
```

Poll `GET /health` to detect when the service has restarted. The CLI command `routerly update run` does this automatically.

---

## Personal MCP Surface

Every user manages their own [MCP](../concepts/mcp.md) tokens and sees the
tools those tokens expose. These routes live under `/api/me`: they act on the
caller and require no permission beyond a valid dashboard session. This is
distinct from the `/mcp` protocol surface itself (see
[Service: MCP Server](../service/endpoints.md#mcp-server)), which is
authenticated by an MCP token rather than a JWT.

### List My Tools

```
GET /api/me/mcp-tools
```

**Auth**: `Authorization: Bearer <jwt>`

Returns the tools the caller's own MCP tokens expose: the registry filtered by
the caller's permissions. A tool the caller cannot call is never listed.

**Response `200`:**
```json
[
  {
    "name": "list_models",
    "scope": "read",
    "description": "List the models configured on this Routerly gateway (id, provider, context window). No secrets are returned.",
    "sourceModule": "catalog.registry",
    "permission": "model:read"
  },
  {
    "name": "toggle_model",
    "scope": "write",
    "description": "Enable or disable one of a project's model refs (flips its `enabled` flag). The flag is persisted but not yet honored by the routing engine. Requires the 'project:write' permission.",
    "sourceModule": "config.store",
    "permission": "project:write"
  }
]
```

`sourceModule` is the internal DI token key of the module backing the tool
(e.g. `catalog.registry`, `config.store`). A tool is only present when its
backing module is bootstrapped on this instance; a module that is not running
removes its tools from the list entirely.

### List My Tokens

```
GET /api/me/mcp-tokens
```

**Auth**: `Authorization: Bearer <jwt>`

**Response `200`:**
```json
[
  {
    "id": "2f1c0b8a-6d4e-4a2f-9f10-0b3f1c8e77aa",
    "name": "laptop",
    "tokenSnippet": "sk-rt-mcp-8f3c",
    "createdAt": "2026-07-01T09:12:00.000Z",
    "lastUsedAt": "2026-07-31T18:40:12.000Z",
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }
]
```

The stored SHA-256 hash never leaves the service: `tokenSnippet` is the
display identity. `lastUsedAt` and `expiresAt` are absent when unset.

### Create My Token

```
POST /api/me/mcp-tokens
```

**Auth**: `Authorization: Bearer <jwt>`

```json
{
  "name": "laptop",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

**Fields:**
- `name` - 1 to 60 characters, unique among the caller's tokens (required)
- `expiresAt` - ISO 8601 instant (optional). Omit for a token that never expires

**Response `201`:** the token record plus `token`, the raw value. **This is
the only time it is returned**; only its hash is stored.

```json
{
  "id": "2f1c0b8a-6d4e-4a2f-9f10-0b3f1c8e77aa",
  "name": "laptop",
  "tokenSnippet": "sk-rt-mcp-8f3c",
  "createdAt": "2026-07-01T09:12:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "token": "sk-rt-mcp-8f3c1d…"
}
```

**Errors**: `400` invalid body · `409` `An MCP token named "<name>" already exists`

### Revoke My Token

```
DELETE /api/me/mcp-tokens/:id
```

**Auth**: `Authorization: Bearer <jwt>`

**Response `204`**, no body. Revocation is immediate: a client using that
token fails its next call. Only the caller's own tokens are visible here, so
another user's id is reported as not found.

**Errors**: `404` `{ "error": "Token not found" }`

