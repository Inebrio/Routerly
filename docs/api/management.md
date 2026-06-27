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
  "capabilities": ["functionCalling", "json"]
}
```

### Get Model

```
GET /api/models/:id
```

### Update Model

```
PUT /api/models/:id
```

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

Guardrails evaluate each request and/or response against an ordered list of rules;
the first matching enabled rule triggers the configured action.

```json
{
  "guardrails": {
    "enabled": true,
    "action": "block",
    "fallbackMessage": "This request was blocked by content guardrails.",
    "rules": [
      {
        "type": "regex",
        "enabled": true,
        "target": "request",
        "config": { "patterns": ["competitor", "rival\\s+product"] }
      },
      {
        "type": "injection",
        "enabled": true,
        "target": "request",
        "config": {}
      },
      {
        "type": "topic",
        "enabled": true,
        "target": "both",
        "config": {
          "modelId": "openai/gpt-4o-mini",
          "allowedTopics": "Customer support questions about our product only",
          "threshold": 0.5
        }
      },
      {
        "type": "moderation",
        "enabled": true,
        "target": "both",
        "config": { "modelId": "openai/gpt-4o-mini", "threshold": 0.7 }
      }
    ]
  }
}
```

**Rule types:**

| Type | Target | Config fields | Description |
|------|--------|---------------|-------------|
| `regex` | request / response / both | `patterns: string[]` | Block text matching any regex pattern (case-insensitive) |
| `injection` | request | _(none)_ | Detect prompt injection attacks (built-in patterns: "ignore previous instructions", DAN mode, jailbreak, etc.) |
| `semantic` | request / response / both | `embeddingModelId`, `examples: string[]`, `threshold?: number` (default 0.82) | Block semantically similar content using embedding cosine similarity |
| `topic` | request / response / both | `modelId`, `allowedTopics: string`, `threshold?: number` (default 0.5) | LLM judge: block content not matching the allowed topics description |
| `moderation` | request / response / both | `modelId`, `threshold?: number` (default 0.5) | LLM judge: block harmful content (hate, violence, sexual, self-harm) |

**Action values:**
- `block` — reject before forwarding; the request never reaches the model. Returns a wire-faithful HTTP 200 response (`finish_reason: "content_filter"` for OpenAI, `stop_reason: "refusal"` for Anthropic). Records a usage entry with `outcome: "blocked"`, `callType: "guardrail"`, zero tokens and cost, and `blockedBy` set to the triggering rule. See [LLM Proxy — Guardrail block wire format](./llm-proxy.md#guardrail-block--wire-format).
- `flag` — forward the request; record `guardrailTriggered` on the usage record (outcome remains `success` or `error`).
- `log` — log only, no usage record side-effect.

**Target values:** `request` evaluates the user messages; `response` evaluates the model output; `both` evaluates both sides.

#### PII

```json
{
  "pii": {
    "enabled": true,
    "entities": ["EMAIL", "PHONE", "CREDIT_CARD", "SSN", "IBAN"],
    "scrubInput": true,
    "scrubOutput": false
  }
}
```

`pii.entities` defaults to all entity types when omitted. Matched values in
message string content are replaced with typed placeholders
(`[EMAIL]`, `[PHONE_NUMBER]`, `[CREDIT_CARD]`, `[SSN]`, `[IBAN]`) before the
request is forwarded to the provider.

`scrubInput` (default `true`) controls whether user message content is scrubbed
before sending to the provider. `scrubOutput` (default `false`) controls whether
the provider's response content is scrubbed before returning to the caller. Set
`scrubOutput: true` when your model may echo or repeat sensitive values in its reply.

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

Guardrails with `block` action return a wire-faithful HTTP 200 response — they
do **not** return HTTP 400. See [LLM Proxy — Guardrail block wire format](./llm-proxy.md#guardrail-block--wire-format).

Guardrails with `flag` or `log` action forward requests to the model with no
consumer-visible impact. The event is recorded on the usage record for audit purposes.

### Delete Project

```
DELETE /api/projects/:slug
```

---

## Agent Policies

### List Agent Policies

```
GET /api/agent-policies?projectId=<id>
```

**Auth**: `Authorization: Bearer <jwt>` (requires `project:read`)

**Query parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | The project UUID |

**Response** `200`
```json
[
  {
    "name": "code-requests",
    "models": ["gpt-5", "gpt-5-mini"],
    "maxCostUsd": 0.50,
    "maxLatencyMs": 5000
  }
]
```

Returns an empty array if the project has no agent policies. Returns `400` if `projectId` is missing, `404` if the project is not found.

### Update Agent Policies

```
PUT /api/agent-policies
```

**Auth**: `Authorization: Bearer <jwt>` (requires `project:write`)

**Request body**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "agentPolicies": [
    {
      "name": "code-requests",
      "models": ["gpt-5", "gpt-5-mini"],
      "maxCostUsd": 0.50,
      "maxLatencyMs": 5000
    },
    {
      "name": "billing",
      "models": ["gpt-5-nano"],
      "maxCostUsd": 0.10
    }
  ]
}
```

**Validation**:

- Each policy must have a non-empty `name` (trimmed)
- Policy names must be unique within the project
- `models` must be a non-empty array of non-empty strings
- `maxCostUsd` and `maxLatencyMs`, if present, must be non-negative numbers

**Response** `200`
```json
[
  {
    "name": "code-requests",
    "models": ["gpt-5", "gpt-5-mini"],
    "maxCostUsd": 0.50,
    "maxLatencyMs": 5000
  },
  {
    "name": "billing",
    "models": ["gpt-5-nano"],
    "maxCostUsd": 0.10
  }
]
```

**Errors**: `400` invalid body (missing projectId, not an array, invalid policy structure) · `403` insufficient permissions · `404` project not found

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

**Response includes the token value in plain text — returned once only.**

### Update Token

```
PUT /api/projects/:slug/tokens/:tokenId
```

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
| `model` | string | Filter by model ID |
| `outcome` | string | `success`, `error`, `budget_exceeded`, `timeout`, `blocked` |
| `limit` | number | Max records to return (default: 100) |
| `offset` | number | Pagination offset |

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
  "byModel": {},
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
| `errorCalls` | Failed calls — does **not** include blocked calls |

Guardrail judge call records appear in the `records` array with `callType: "guardrail"`. Blocked request records appear with `outcome: "blocked"` and `callType: "guardrail"`. The `errorCalls` counter excludes blocked requests — a block is a normal guardrail outcome, not a model error.

The `outcome` filter on `GET /api/usage` accepts `blocked` in addition to `success`, `error`, and `budget_exceeded`.

Individual usage records for blocked requests carry `guardrailTriggered` (the rule identifier, e.g. `regex:pattern` or `injection:dan-mode`) and `blockedBy` (same value; present only when the outcome is `blocked`). Records where PII was redacted carry `piiRedacted` with an array of redacted entity types. Records where a guardrail triggered on the `flag` or `log` path carry `guardrailTriggered` but not `blockedBy`.

:::note Wire format unchanged
The block response sent to the API client is standard and unchanged: HTTP 200, empty content, `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic). Only observability around the block changed — the usage record is now written and the summary counts it separately.
:::

### Get Routing Trace

```
GET /api/traces/:id
```

Returns the routing trace (`{ trace: [...] }`). The trace includes:

- `guardrail:evaluated` — emitted after every guardrail check (pass or skip), with a `rules` array showing each rule's `outcome` (`passed`, `triggered`, or `skipped`) and `reason`. This entry is emitted even when no rule fires, so you can see which rules ran and which were skipped.
- `guardrail:triggered` — emitted on a request-side match (action `flag`/`log`; the request still proceeds).
- `guardrail:response-triggered` — emitted on a response-side match.
- `pii:scrubbed` — emitted when PII was detected and replaced.

Use the `x-routerly-trace-id` header from any LLM proxy response — present even on blocked responses — to look up its trace:

```bash
curl -s http://localhost:3000/api/traces/$TRACE_ID \
  -H "Authorization: Bearer <jwt>"
```

---

## Settings

### Get Settings

```
GET /api/settings
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
  "publicUrl": "https://routerly.example.com"
}
```

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

The in-app notification inbox is per-user and available to any authenticated dashboard user (no special permission required). Returns only items for the current user (matched by the `targets` of the `dashboard` channel that created each item, or all items when no targeting was configured).

```
GET /api/notifications/inbox?limit=50&unreadOnly=false
```

**Query params:**
- `limit` — max items to return (1–200, default 50)
- `unreadOnly` — when `true`, returns only items the current user has not read

**Response `200`:**
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
  "unreadCount": 1
}
```

Items are returned newest-first. `unreadCount` is the total unread count for the current user (independent of `limit`).

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

### Test (legacy endpoint)

```
POST /api/notifications/test
```

```json
{ "channelId": "abc-uuid" }
```

Returns `200 OK` on success or an error with details. Prefer `POST /api/notifications/channels/:id/test`.

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
