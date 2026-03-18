# Configuration

Routerly is configured through environment variables and JSON files stored under `~/.routerly/`.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ROUTERLY_SECRET_KEY` | **Yes** | — | Base64-encoded 256-bit AES key used to encrypt API keys and tokens at rest. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ROUTERLY_HOME` | No | `~/.routerly` | Override the storage directory for all config and data files |
| `NODE_ENV` | No | — | Set to `production` to disable pino-pretty log formatting |

---

## Config File Structure

All configuration is stored in JSON files under `$ROUTERLY_HOME/config/`:

```
~/.routerly/
├── config/
│   ├── settings.json    # service settings (port, log level, dashboard toggle)
│   ├── models.json      # registered LLM models (API keys stored encrypted)
│   ├── projects.json    # projects and their tokens, model assignments, policies
│   ├── users.json       # dashboard users (passwords stored hashed)
│   └── roles.json       # custom RBAC role definitions
└── data/
    └── usage.json       # per-call usage records (tokens, cost, latency)
```

These files are managed automatically by the service and CLI — you do not need to edit them manually.

---

## settings.json

Controls service behavior. Managed via `routerly service configure` or through the Dashboard > Settings page.

```json
{
  "port": 3000,
  "host": "127.0.0.1",
  "logLevel": "info",
  "dashboardEnabled": true
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `3000` | TCP port the service listens on |
| `host` | `127.0.0.1` | Bind address. Use `0.0.0.0` to listen on all interfaces |
| `logLevel` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error` |
| `dashboardEnabled` | `true` | Serve the React dashboard at `/dashboard/`. Set to `false` to disable |

---

## Custom Storage Path

To store config and data in a different location:

```bash
export ROUTERLY_HOME=/opt/routerly

# or per-invocation:
ROUTERLY_HOME=/opt/routerly node --import tsx/esm packages/service/src/index.ts
```

---

## Production Checklist

Before running in production:

- [ ] `ROUTERLY_SECRET_KEY` is set and stored securely
- [ ] `settings.json` has `"host": "0.0.0.0"` if the service needs to be network-accessible
- [ ] `ROUTERLY_HOME` directory has appropriate file permissions (readable only by the service user)
- [ ] `NODE_ENV=production` is set (disables pretty-print logs, improves performance)
- [ ] Consider a reverse proxy (nginx / Caddy) in front of Routerly for TLS termination

See also → [Self-hosting Guide](../service/../guides/self-hosting.md) *(coming soon)*
