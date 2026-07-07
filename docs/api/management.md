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

- `token` — short-lived JWT (1 hour). Use as `Authorization: Bearer <token>` on all other endpoints.
- `refreshToken` — opaque token used to obtain new access tokens without re-entering credentials. Store securely; see [POST /api/auth/refresh](#refresh). Rotates on every use.

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

Issues a new 1-hour access token **and a new refresh token** (rotation). The previous refresh token is immediately invalidated — replace it with the value returned in the response. Returns `401` if the token is invalid or has already been used/revoked.

:::note
The CLI and dashboard perform this refresh automatically — the CLI tries silently when the token expires or is within 5 minutes of expiry; the dashboard retries on any `401` response. Both clients persist the new refresh token automatically.
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

### List Models

```
GET /api/models
```

### Create Model

```
POST /api/models
```

```json
{
  "id": "gpt-5-mini",
  "provider": "openai",
  "apiKey": "sk-...",
  "inputPrice": 0.25,
  "outputPrice": 2.0,
  "contextWindow": 128000,
  "capabilities": ["functionCalling", "json"],
  "fieldOverrides": { "inputPrice": true }
}
```

**Request fields:**
- `fieldOverrides` (optional) — object mapping field names to `true` to lock them against catalog sync. Supported fields: `inputPrice`, `outputPrice`, `cachePrice`, `cacheWritePrice`, `pricingTiers`, `contextWindow`, `capabilities`.

**Response includes:**
- `catalogDefaults` (if model is in catalog) — last known catalog values for each tracked field
- `fieldOverrides` (if any) — which fields are locked against auto-sync

### Get Model

```
GET /api/models/:id
```

**Response includes:**
- `catalogDefaults` (if model is in catalog) — object with keys: `inputPrice`, `outputPrice`, `cachePrice`, `cacheWritePrice`, `pricingTiers`, `contextWindow`, `capabilities` (whichever were synced from the catalog)
- `fieldOverrides` (if any) — object with field names as keys, all values set to `true`

### Update Model

```
PUT /api/models/:id
```

**Request body** (all fields optional):
```json
{
  "inputPrice": 0.5,
  "fieldOverrides": { "inputPrice": true, "contextWindow": false }
}
```

Changing a field value automatically sets `fieldOverrides[fieldName] = true`. To unlock a field for auto-sync, send `"fieldOverrides[fieldName] = false"`. When all overrides are cleared, the `fieldOverrides` object is removed from the model config.

### Delete Model

```
DELETE /api/models/:id
```

### Rotate Model API Key

```
POST /api/models/:id/apikey
```

```json
{ "apiKey": "sk-NEW_KEY" }
```

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
  "defaultTimeoutMs": 30000,
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
each enabled rule is evaluated in sequence, and a matching rule triggers its configured
block and/or log actions independently.

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
        "blockMessage": "Your request contains blocked content.",
        "config": { "patterns": ["competitor", "rival\\s+product"] }
      },
      {
        "type": "semantic",
        "enabled": true,
        "target": "both",
        "block": false,
        "log": true,
        "config": {
          "embeddingModelId": "text-embedding-3-small",
          "examples": ["example of blocked content"],
          "threshold": 0.82
        }
      },
      {
        "type": "topic",
        "enabled": true,
        "target": "response",
        "block": true,
        "log": true,
        "useJudgeResponse": true,
        "blockMessage": "This topic is not allowed. Please rephrase your request.",
        "config": {
          "modelId": "claude-haiku-4-5",
          "allowedTopics": "Customer support questions about our product only",
          "threshold": 0.5
        }
      },
      {
        "type": "moderation",
        "enabled": true,
        "target": "request",
        "block": true,
        "log": true,
        "config": { "modelId": "claude-haiku-4-5", "threshold": 0.5 }
      }
    ]
  }
}
```

**Rule types:**

| Type | Target | Config fields | Description |
|------|--------|---------------|-------------|
| `regex` | request / response / both | `patterns: string[]` | Block text matching any regex pattern (case-insensitive) |
| `semantic` | request / response / both | `embeddingModelId`, `examples: string[]`, `threshold?: number` (default 0.82) | Block semantically similar content using embedding cosine similarity |
| `topic` | request / response / both | `modelId`, `allowedTopics: string`, `threshold?: number` (default 0.5) | LLM judge: block content not matching the allowed topics description |
| `moderation` | request / response / both | `modelId`, `threshold?: number` (default 0.5) | LLM judge: block harmful content (hate, violence, sexual, self-harm) |

**Rule fields:**
- `block?: boolean`: reject the request/response when this rule triggers. When true and the rule target includes `response`, the entire response is buffered before the block decision, which disables streaming for the request.
- `log?: boolean`: record the trigger in usage (monitor) for audit purposes, independently of whether the rule blocks.
- `blockMessage?: string`: custom message returned to the client when this rule blocks. Falls back to a built-in default when absent. Ignored when `useJudgeResponse` is true and the judge returns a message.
- `useJudgeResponse?: boolean`: (topic/moderation only) use the judge model's own explanation as the block response. The judge is asked to return `{ score, message }`; on block, the `message` is returned to the client, falling back to `blockMessage` (then a built-in default) when the judge fails or returns none.

**detectInjection flag:**
- When `true`, run a built-in prompt-injection detector on every request before rule evaluation. A hit blocks and is logged (equivalent to a rule with `block: true, log: true`). Injection detection does not support custom messages.

**Target values:** `request` evaluates the user messages; `response` evaluates the model output; `both` evaluates both sides.

**Streaming interaction:** When any enabled rule has `block: true` AND `target` is `response` or `both`, the entire response must be buffered before the block decision is made. In this case, streaming is disabled for the request, and the client receives the full response as a single chunk.

#### PII

```json
{
  "pii": {
    "policies": [
      {
        "name": "default",
        "enabled": true,
        "target": "both",
        "entities": ["EMAIL", "PHONE", "CREDIT_CARD", "SSN", "IBAN"],
        "outputBufferSize": 30
      },
      {
        "name": "pii-request-only",
        "enabled": true,
        "target": "request",
        "entities": ["EMAIL", "PHONE"],
        "customPatterns": ["\\b[A-Z]{2}[0-9]{6,8}\\b"]
      }
    ]
  }
}
```

PII configuration contains a list of named policies. All enabled policies are merged per-direction
at scrub time (request scrubbing merges policies with `target: request` or `target: both`;
response scrubbing merges policies with `target: response` or `target: both`).

**Policy fields:**
- `name: string`: unique identifier for this policy
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
and are subject to the same budget limits — an over-budget judge call fails
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
- `name` — token name (required)
- `tags` — arbitrary key-value metadata attached to the token (optional). Tags are included in every usage record created with this token.
- `limits` — array of per-token spending limits (optional)

**Response includes the token value in plain text — returned once only.** The response also includes the `tags` object.

### Update Token

```
PUT /api/projects/:slug/tokens/:tokenId
```

```json
{
  "tags": {
    "environment": "staging"
  }
}
```

**Fields:**
- `tags` — replace the token's tags. Pass an empty object `{}` to clear all tags (optional).

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
| `callType` | string | `completion`, `routing`, or `guardrail`. `completion` also matches legacy records with no `callType` field |
| `outcome` | string | `success`, `error`, `budget_exceeded`, `timeout`, `blocked`. `error` matches records that are neither `success` nor `blocked` |
| `limit` | number | Max records to return (default: 100) |
| `offset` | number | Pagination offset |

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

Individual usage records for blocked requests carry `guardrailTriggered` (the rule identifier, e.g. `regex:pattern` or `injection:dan-mode`) and `blockedBy` (same value; present only when the outcome is `blocked`). Records where PII was redacted carry `piiRedacted` with an array of redacted entity types. Records where a guardrail triggered on the `flag` or `log` path carry `guardrailTriggered` but not `blockedBy`.

:::note Wire format unchanged
The block response sent to the API client is standard and unchanged: HTTP 200, empty content, `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic). Only observability around the block changed — the usage record is now written and the summary counts it separately.
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

Use the `x-routerly-trace-id` header from any LLM proxy response — present even on blocked responses — to look up its trace:

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
  "logLevel": "info",
  "defaultTimeoutMs": 30000,
  "publicUrl": "https://routerly.example.com",
  "providerRepos": [
    {
      "url": "https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/",
      "enabled": true,
      "channel": null
    }
  ]
}
```

### Update Settings

```
PUT /api/settings
```

```json
{
  "port": 3000,
  "logLevel": "info",
  "defaultTimeoutMs": 30000,
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
- `port`, `logLevel`, `defaultTimeoutMs`, `publicUrl` — service configuration (optional)
- `providerRepos` — array of provider repository objects (optional)

**ProviderRepo object:**
- `url` — repository endpoint (required)
- `enabled` — whether the repo is active (optional, default `true`)
- `channel` — named channel to prefer (optional, e.g. `stable`, `latest`)

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
- `url` — repository endpoint
- `enabled` — whether this repo is active
- `resolvedFile` — filename of the last successfully fetched catalog (null if never fetched)
- `updatedAt` — timestamp from the catalog registry (null if never fetched)
- `lastChecked` — when Routerly last attempted to fetch from this repo
- `error` — error message if the last fetch failed (null on success)
- `cachedAt` — when the current catalog was loaded into memory
- `expiresAt` — when the 5-minute cache expires

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

**Response `200` (partial failure — some repos errored):**
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
| `targets` | object | no | `{ roles, permissions, users }` — who receives (empty = everyone). Controls inbox visibility for `dashboard` and recipient resolution for email channels; ignored for webhook/native channels |

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

The in-app notification inbox is per-user, available to any authenticated dashboard user (no special permission required). Returns only items for the current user (matched by the `targets` of the `dashboard` channel that created each item, or all items when no targeting was configured). Users can also dismiss items individually (soft delete), which removes them from their personal inbox only.

#### List Inbox Items

```
GET /api/notifications/inbox?limit=50&page=1&pageSize=20&severity=all&event=&unreadOnly=false&from=&to=
```

**Query params:**
- `limit` - max items in legacy flat-list response (1–200, default 50). When `page` is omitted, activates flat-list mode; presence of `page` switches to paginated mode.
- `page` - page number for paginated response (1-indexed, default 1)
- `pageSize` - items per page (1–100, default 20)
- `severity` - filter by severity: `info`, `warning`, `critical`, or `all` (default `all`)
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
      "details": { "modelId": "openai/gpt-4o" },
      "read": false
    }
  ],
  "unreadCount": 5,
  "enabled": true
}
```

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
  "details": { "modelId": "openai/gpt-4o", "latencyMs": 5000 },
  "read": false
}
```

**Errors**: `404` notification not found (either does not exist or is not in the current user's inbox)

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

**Request body** — per-type examples:

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
