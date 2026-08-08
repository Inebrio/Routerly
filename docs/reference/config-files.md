---
title: Config Files
sidebar_position: 1
---

# Config Files

Routerly stores all configuration as JSON files. The exact location depends on the **installation scope** chosen at install time. Files are written atomically and are human-readable.

The service reads the root directory from the `ROUTERLY_HOME` environment variable (set automatically by the installer in the daemon unit). If the variable is not set, it falls back to `~/.routerly/`.

## Directory Layout

### User scope (default)

Everything lives under the installing user's home directory.

```
~/.routerly/
├── app/               # Service binary (managed by installer)
├── config/
│   ├── settings.json     # Global settings
│   ├── models.json       # Registered LLM models
│   ├── routers.json     # Routers, routing, budgets, tokens
│   ├── users.json        # User accounts
│   ├── roles.json        # Custom roles and permissions
│   ├── modules.json      # Which modules are enabled
│   ├── profiles.json     # Routing profiles
│   ├── connections.json  # Provider connections
│   ├── instances.json    # Model instances
│   ├── experiments.json  # A/B tests, their variants and tokens
│   └── secret            # JWT signing key (mode 0600, keep safe)
└── data/
    ├── usage.ndjson     # Usage records (append-only NDJSON)
    ├── notifications.json # Notification inbox
    ├── audit.json        # Audit log
    └── update-announcement.json # Last update alert announced (RA-15)
```

### System scope

Service config and data move to a system-wide directory; the CLI auth tokens remain per-user.

| Platform | Service config & data directory |
|----------|---------------------------------|
| Linux    | `/var/lib/routerly/`            |
| macOS    | `/Library/Application Support/Routerly/` |
| Windows  | `C:\ProgramData\Routerly\`      |

```
/var/lib/routerly/          # (Linux example; see table above for other platforms)
├── config/
│   ├── settings.json
│   ├── models.json
│   ├── routers.json
│   ├── users.json
│   ├── roles.json
│   ├── modules.json
│   ├── profiles.json
│   ├── connections.json
│   ├── instances.json
│   ├── experiments.json
│   └── secret              # JWT signing key (mode 0600)
└── data/
    ├── usage.ndjson
    ├── notifications.json
    ├── audit.json
    └── update-announcement.json
```

### CLI auth tokens (always per-user)

Regardless of install scope, each user's CLI credentials are stored in their own home directory, never in the system directory:

```
~/.routerly/
└── cli/
    └── config.json         # Saved accounts, JWT tokens, refresh tokens (mode 0600)
```

---

## settings.json

Global service configuration.

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "dashboardEnabled": true,
  "logLevel": "info",
  "publicUrl": "http://localhost:3000",
  "channel": "current",
  "notifications": {
    "channels": [],
    "notificationRules": [],
    "cooldowns": {}
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `3000` | TCP port the service listens on |
| `host` | `string` | `"0.0.0.0"` | Bind address. Use `127.0.0.1` behind a reverse proxy |
| `dashboardEnabled` | `boolean` | `true` | Enable or disable the web dashboard |
| `logLevel` | `string` | `"info"` | Log verbosity: `"error"`, `"warn"`, `"info"`, `"debug"` |
| `publicUrl` | `string` | `"http://localhost:3000"` | Externally reachable URL, used for notification links |
| `channel` | `string` | `"current"` | Update channel: `"latest"`, `"current"`, `"next"`, or a version tag such as `"v0.2.0"`. `"stable"`/`"develop"` are accepted as deprecated aliases for `"current"`/`"next"`. Controls which GitHub Release the update checker compares against |
| `notifications.channels` | `array` | `[]` | Notification channel objects. Each has `provider`, optional `name`, `id`, `events` (event patterns), `targets` (`{ roles, permissions, users }`), plus provider-specific fields. See [Notifications](../concepts/notifications.md) |
| `notifications.notificationRules` | `array` | `[]` | Route event patterns to specific channel IDs: `{ events, channels }` |
| `notifications.cooldowns` | `object` | `{}` | Minimum interval between repeated dispatches per event type (e.g. `"provider.degraded": "15m"`) |

---

## models.json

Array of registered LLM model configurations.

```json
[
  {
    "id": "gpt-5-mini",
    "provider": "openai",
    "apiKey": "ENCRYPTED:...",
    "inputPrice": 0.00015,
    "outputPrice": 0.0006,
    "cachePrice": 0.000075,
    "contextWindow": 128000,
    "capabilities": ["chat", "vision"],
    "enabled": true
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique model identifier within Routerly |
| `provider` | `string` | Provider name: `openai`, `anthropic`, `gemini`, `mistral`, `cohere`, `xai`, `ollama`, `custom` |
| `apiKey` | `string` | API key — stored AES-256 encrypted with the value from `secret` |
| `inputPrice` | `number` | Cost per 1,000 input tokens in USD |
| `outputPrice` | `number` | Cost per 1,000 output tokens in USD |
| `cachePrice` | `number` | Cost per 1,000 cached/read tokens in USD (optional) |
| `contextWindow` | `number` | Maximum context window in tokens |
| `capabilities` | `string[]` | Supported capabilities: `"chat"`, `"vision"`, `"tools"`, `"json_mode"` |
| `pricingTiers` | `array` | Volume-based pricing tiers (optional) |
| `enabled` | `boolean` | Whether the model is available for routing |
| `baseUrl` | `string` | Custom base URL — required for `custom` provider, used for non-default Ollama hosts |

:::caution
Never edit `apiKey` values manually. Use the dashboard or CLI to manage API keys; they are encrypted using the `secret` file.
:::

---

## routers.json

Array of Router configurations: routers, Orchestrators, and Passthrough Routers alike (see [Concepts: Routers](../concepts/routers.md) and [Concepts: Architecture](../concepts/architecture.md#router-orchestrator-passthrough) for the three kinds). Migrated automatically and idempotently from the pre-rename `projects.json` on first start.

```json
[
  {
    "id": "a1b2c3d4-e5f6-4a1b-8c2d-9e0f1a2b3c4d",
    "name": "My App",
    "timeoutMs": 2000,
    "policies": [{ "type": "cheapest" }],
    "models": [{ "modelId": "gpt-5-mini" }, { "modelId": "claude-haiku-4-5" }],
    "tokens": [
      {
        "id": "b2c3d4e5-f6a1-4b2c-9d3e-0f1a2b3c4d5e",
        "token": "sk-rt-...",
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ],
    "members": [
      { "userId": "usr_abc", "role": "admin" }
    ]
  }
]
```

### Router Fields (kind `router`, the default)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Internal Router ID (UUID) |
| `name` | `string` | Human-readable Router name |
| `kind` | `string` | `"router"` \| `"orchestrator"` \| `"passthrough"`. Absent means `"router"` (every Router stored before this field existed) |
| `timeoutMs` | `number` | Time-to-first-token timeout per model attempt, in milliseconds. Default `2000`; `0` disables it |
| `policies` | `RoutingPolicy[]` | Routing policies in priority order (each `{ type, ...params }`); see [Concepts: Routing](../concepts/routing.md) |
| `models` | `array` | Target models: `{ modelId, prompt? }` |
| `candidates` | `array` | Only on `kind: "orchestrator"`: `{ routerId, limits? }` — other Routers this one forwards to, in priority order (index 0 = highest); no `weight` field |
| `slug` | `string` | Only on `kind: "passthrough"`: the URL path segment at `/passthrough/<slug>/*` |

Budgets are not a top-level array on the Router: they live as `limits` on a model entry or on a token (see Token Fields below), not on the Router record itself.

### Token Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Token ID (UUID) |
| `token` | `string` | Router token, stored in plaintext (file permissions `0600` protect it — the proxy must compare it against an incoming `Authorization` header of unknown origin) |
| `expiresAt` | `string` | Optional ISO 8601 expiry; absent or null means never expires |
| `models` | `array` | Optional per-token, per-model budget overrides |
| `createdAt` | `string` | ISO 8601 creation timestamp |

---

## users.json

Array of user accounts.

```json
[
  {
    "id": "usr_abc123",
    "email": "admin@example.com",
    "passwordHash": "$2b$10$...",
    "role": "admin",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | User ID (`usr_…`) |
| `email` | `string` | Login email |
| `passwordHash` | `string` | bcrypt hash of the password |
| `role` | `string` | Global role name: `"admin"`, `"member"`, `"viewer"`, or a custom role |
| `createdAt` | `string` | ISO 8601 creation timestamp |

---

## roles.json

Array of custom role definitions. The three built-in roles (`admin`, `member`, `viewer`) are not stored here and cannot be modified.

```json
[
  {
    "name": "billing-viewer",
    "permissions": ["usage:read"]
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique role name |
| `permissions` | `string[]` | List of permission strings |

Available permissions: `models:write`, `routers:write`, `users:write`, `roles:write`, `settings:write`, `usage:read`, `proxy:use`.

---

## data/usage.ndjson

Append-only NDJSON: one JSON object per line, one line per LLM request. The service appends to this file without reading or rewriting the rest of it, so a write's cost does not grow with the history size. Migrated automatically from a legacy `data/usage.json` array on first start after the upgrade.

```json
{"id":"a1b2c3d4-...","timestamp":"2024-01-15T10:30:00Z","routerId":"b2c3d4e5-...","modelId":"gpt-5-mini","inputTokens":150,"outputTokens":42,"cost":0.000048,"latencyMs":1234,"outcome":"success"}
```

Key fields (see `UsageRecord` in `@routerly/shared` for the full shape):

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Usage record ID |
| `timestamp` | `string` | ISO 8601 |
| `routerId` | `string` | The Router that served the request |
| `modelId` | `string` | The model the request was routed to |
| `inputTokens` / `outputTokens` | `number` | Token counts |
| `cost` | `number \| null` | USD cost; `null` when no model could be priced against (e.g. Passthrough traffic) |
| `latencyMs` | `number` | Forwarding start to last byte received |
| `outcome` | `string` | `"success"`, `"error"`, or `"blocked"` |
| `orchestratorId` | `string` | Set when the call was forwarded through an Orchestrator; `routerId`/`modelId` still identify the Router and model that actually executed it |

This file grows continuously. `routerly service configure --usage-retention-days <n>` and `--usage-retention-max-mb <n>` (or the equivalent Settings page fields) enable an age- and/or size-based retention sweep that drops the oldest records first; both are unset by default and Routerly does not rotate or archive the file on its own.

---

## data/update-announcement.json

Records the last `system.update_available` alert the update checker raised, so the same release is not announced again after a restart. See [Concepts: Notifications](../concepts/notifications.md) for the event itself.

```json
{
  "announcedVersion": "0.5.0",
  "currentVersion": "0.4.0",
  "channel": "stable",
  "announcedAt": "2026-08-04T10:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `announcedVersion` | `string` | The `latestVersion` from the check that raised the alert |
| `currentVersion` | `string` | The version the instance was running when it announced |
| `channel` | `string` | The update channel the announcement came from |
| `announcedAt` | `string` | ISO 8601 timestamp, informational only |

The update checker is the file's only writer: it reads the record before each check and rewrites it whenever it raises a new alert. No API endpoint exposes this file; it is not readable or writable through the dashboard, the CLI, or the management API.

Deleting this file does not disable the alert. It is read the same way a missing or corrupt file is: as "no prior announcement". The next check announces the current channel's release once more and rewrites the file, after which deduplication resumes as normal.

---

## secret

A single-line file containing the 32-byte AES-256 encryption key used to encrypt API keys in `models.json`.

```
a1b2c3d4e5f6...
```

**Never share or commit this file.** If lost, all stored API keys must be re-entered.
