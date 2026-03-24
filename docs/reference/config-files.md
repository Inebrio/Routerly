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
│   ├── settings.json  # Global settings
│   ├── models.json    # Registered LLM models
│   ├── projects.json  # Projects, routing, budgets, tokens
│   ├── users.json     # User accounts
│   ├── roles.json     # Custom roles and permissions
│   └── secret         # JWT signing key (mode 0600, keep safe)
└── data/
    └── usage.json     # Usage records
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
│   ├── projects.json
│   ├── users.json
│   ├── roles.json
│   └── secret              # JWT signing key (mode 0600)
└── data/
    └── usage.json
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
  "defaultTimeoutMs": 30000,
  "logLevel": "info",
  "publicUrl": "http://localhost:3000",
  "notifications": []
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `3000` | TCP port the service listens on |
| `host` | `string` | `"0.0.0.0"` | Bind address. Use `127.0.0.1` behind a reverse proxy |
| `dashboardEnabled` | `boolean` | `true` | Enable or disable the web dashboard |
| `defaultTimeoutMs` | `number` | `30000` | Default provider request timeout in milliseconds |
| `logLevel` | `string` | `"info"` | Log verbosity: `"error"`, `"warn"`, `"info"`, `"debug"` |
| `publicUrl` | `string` | `"http://localhost:3000"` | Externally reachable URL, used for notification links |
| `notifications` | `array` | `[]` | Notification channel configurations — see [Notifications](../concepts/notifications.md) |

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

## projects.json

Array of project configurations including routing policies, budgets, tokens, and members.

```json
[
  {
    "id": "proj_abc123",
    "name": "My App",
    "slug": "my-app",
    "defaultTimeoutMs": 30000,
    "policies": ["random"],
    "models": ["gpt-5-mini", "claude-haiku-4-5"],
    "tokens": [
      {
        "id": "tok_xyz",
        "token": "HASHED:...",
        "description": "Production token",
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ],
    "members": [
      { "userId": "usr_abc", "role": "admin" }
    ],
    "budgets": [
      {
        "metric": "cost",
        "limit": 10.00,
        "windowType": "period",
        "windowSize": "monthly",
        "onExhausted": "block"
      }
    ]
  }
]
```

### Project Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Internal project ID (`proj_…`) |
| `name` | `string` | Human-readable project name |
| `slug` | `string` | URL-safe identifier, used in scoped proxy path `/projects/{slug}/v1/*` |
| `defaultTimeoutMs` | `number` | Per-project request timeout override |
| `policies` | `string[]` | Routing policies in priority order |
| `models` | `string[]` | Model IDs assigned to the project |

### Token Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Token ID (`tok_…`) |
| `token` | `string` | Token value, stored as a bcrypt hash — the plain `sk-lr-…` value is only shown once on creation |
| `description` | `string` | Optional label |
| `createdAt` | `string` | ISO 8601 creation timestamp |

### Budget Fields

| Field | Type | Description |
|-------|------|-------------|
| `metric` | `string` | `"cost"`, `"calls"`, `"input_tokens"`, `"output_tokens"`, `"total_tokens"` |
| `limit` | `number` | Maximum allowed value for the metric |
| `windowType` | `string` | `"period"` (fixed calendar window) or `"rolling"` (sliding window) |
| `windowSize` | `string` | For period: `"hourly"`, `"daily"`, `"weekly"`, `"monthly"`, `"yearly"`. For rolling: `"second"`, `"minute"`, `"hour"`, `"day"`, `"week"`, `"month"` |
| `onExhausted` | `string` | `"block"` — return HTTP 503 when budget is reached |

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

Available permissions: `models:write`, `projects:write`, `users:write`, `roles:write`, `settings:write`, `usage:read`, `proxy:use`.

---

## data/usage.json

Array of usage records, one per LLM request. Written by the service after each completed call.

```json
[
  {
    "id": "use_abc123",
    "timestamp": "2024-01-15T10:30:00Z",
    "projectId": "proj_abc",
    "projectSlug": "my-app",
    "modelId": "gpt-5-mini",
    "provider": "openai",
    "inputTokens": 150,
    "outputTokens": 42,
    "cacheTokens": 0,
    "totalTokens": 192,
    "cost": 0.000048,
    "durationMs": 1234,
    "status": "success",
    "traceId": "trc_xyz"
  }
]
```

This file grows continuously. Routerly does not currently rotate or archive it automatically — back it up and truncate as needed.

---

## secret

A single-line file containing the 32-byte AES-256 encryption key used to encrypt API keys in `models.json`.

```
a1b2c3d4e5f6...
```

**Never share or commit this file.** If lost, all stored API keys must be re-entered.
