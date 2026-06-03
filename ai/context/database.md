# Storage

Routerly uses no external database. All state is stored in JSON files under `ROUTERLY_HOME`.

- **Default path**: `~/.routerly/`
- **Docker path**: `/data` (set via `ROUTERLY_HOME=/data`)

---

## JSON files

### `settings.json`

Global service configuration.

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "dashboardEnabled": true,
  "logLevel": "info",
  "rateLimitEnabled": true,
  "rateLimitWindow": 60000,
  "rateLimitMax": 100
}
```

### `models.json`

Array of configured LLM models.

```json
[
  {
    "id": "uuid",
    "name": "string",
    "provider": "openai | anthropic | gemini | ollama | custom",
    "modelId": "string",          // provider model identifier (e.g. "gpt-4o")
    "apiKey": "string",           // encrypted or raw key
    "baseUrl": "string",          // optional, for custom/ollama
    "enabled": true,
    "contextWindow": 128000,
    "inputCostPer1k": 0.005,
    "outputCostPer1k": 0.015,
    "capabilities": ["vision", "tools", "json-mode"],
    "rpmLimit": 500,
    "tpmLimit": 100000
  }
]
```

### `projects.json`

Array of projects. Each project holds its Bearer token and routing config.

```json
[
  {
    "id": "uuid",
    "name": "string",
    "token": "hashed-bearer-token",  // stored as SHA-256 hash
    "enabled": true,
    "models": ["model-id-1", "model-id-2"],
    "routingPolicies": ["cheapest", "health"],
    "budget": {
      "monthly": 50.0,
      "currency": "USD"
    },
    "createdAt": "ISO-8601"
  }
]
```

### `users.json`

Array of dashboard users.

```json
[
  {
    "id": "uuid",
    "username": "string",
    "passwordHash": "bcrypt-hash",        // bcrypt 12 rounds
    "refreshTokenHash": "sha256-hash",    // SHA-256 of the raw refresh token
    "role": "admin | operator | viewer | custom-role-id",
    "createdAt": "ISO-8601"
  }
]
```

### `roles.json`

Array of roles (includes built-in + custom).

```json
[
  {
    "id": "admin",
    "name": "Admin",
    "permissions": ["*"],
    "builtin": true
  },
  {
    "id": "custom-uuid",
    "name": "My Role",
    "permissions": ["project:read", "model:read"],
    "builtin": false
  }
]
```

### `config/secret`

Single-line file containing the HMAC-SHA256 JWT signing key (64 random bytes as hex string).
Permissions: `0600`. Never committed to version control.

### `data/usage.json`

Append-only NDJSON (one JSON object per line). Never rewritten in full.

```json
{ "ts": "ISO-8601", "projectId": "uuid", "modelId": "uuid", "inputTokens": 123, "outputTokens": 456, "costUsd": 0.00123, "traceId": "uuid", "durationMs": 892 }
```

---

## Access patterns

| Function | File | Description |
|----------|------|-------------|
| `readConfig(key)` | `config/loader.ts` | Read and parse a JSON config file |
| `writeConfig(key, data)` | `config/loader.ts` | Atomic write with `proper-lockfile` |
| `getOrCreateSecret()` | `config/loader.ts` | Read or generate `config/secret` |
| `appendUsageRecord(record)` | `config/loader.ts` | Append one line to `data/usage.json` |

Config keys map to file paths:
- `"settings"` → `ROUTERLY_HOME/settings.json`
- `"models"` → `ROUTERLY_HOME/models.json`
- `"projects"` → `ROUTERLY_HOME/projects.json`
- `"users"` → `ROUTERLY_HOME/users.json`
- `"roles"` → `ROUTERLY_HOME/roles.json`

---

## Concurrency and limitations

- **Concurrent writes** are serialized with `proper-lockfile` (file-level lock)
- **No transactions**: two writes cannot be atomic across two config files
- **No queries**: reads always load the entire file into memory
- **No indexing**: lookups are O(n) array scans
- These limitations are intentional (see `ai/memory/decisions.md` — Storage decision)
- For large installations with hundreds of projects or millions of usage records, consider a fork with a real database
