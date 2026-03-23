---
title: Configuration
sidebar_position: 3
---

# Configuration

Routerly stores all configuration as JSON files under `~/.routerly/`. This page explains the layout, the main settings, and all environment variables.

---

## Directory Structure

```
~/.routerly/
├── config/
│   ├── settings.json     # Port, log level, notifications, …
│   ├── models.json       # Registered LLM models (API keys encrypted)
│   ├── projects.json     # Projects, routing policies, tokens, members
│   ├── users.json        # Dashboard users (passwords bcrypt-hashed)
│   ├── roles.json        # Custom RBAC role definitions
│   └── secret            # AES-256 encryption key (auto-generated)
└── data/
    └── usage.json        # Append-only usage records
```

Override the base directory with the `ROUTERLY_HOME` environment variable — useful for Docker volumes or multi-instance setups.

```bash
# Docker example
docker run -e ROUTERLY_HOME=/data -v routerly_data:/data ...
```

---

## Service Settings (`settings.json`)

### Configure via CLI

```bash
routerly service configure \
  --port 3000 \
  --host 0.0.0.0 \
  --dashboard true \
  --log-level info \
  --timeout 30000 \
  --public-url http://localhost:3000
```

### Configure via Dashboard

Open **Settings → General** in the dashboard. Changes take effect immediately (no restart required except for port/host changes).

### Settings reference

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `3000` | TCP port the service listens on |
| `host` | `"0.0.0.0"` | Bind address (`"127.0.0.1"` for local-only) |
| `dashboardEnabled` | `true` | Whether to serve the web dashboard |
| `defaultTimeoutMs` | `30000` | Per-request timeout in milliseconds |
| `logLevel` | `"info"` | Log verbosity: `trace` / `debug` / `info` / `warn` / `error` |
| `publicUrl` | `"http://localhost:3000"` | External URL shown in the dashboard connection snippets |
| `notifications` | `[]` | Array of notification channel configurations |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ROUTERLY_HOME` | Config/data directory (default: `~/.routerly`) |
| `ROUTERLY_PORT` | Service port (overrides `settings.json`) |
| `ROUTERLY_SCOPE` | Installation scope: `user` or `system` |
| `ROUTERLY_PUBLIC_URL` | External URL of the service |
| `NODE_ENV` | Set to `production` to disable pretty-printed logs |

---

## Security Notes

- **API keys** (in `models.json`) and **project tokens** (in `projects.json`) are AES-256 encrypted using the key stored in the `secret` file.
- **User passwords** (in `users.json`) are bcrypt-hashed and never stored in plain text.
- The `secret` file is generated automatically on first run.

:::warning Back up the `secret` file
If you lose the `secret` file, all API keys and project tokens become unreadable. Always include it in your backups alongside the rest of `~/.routerly/config/`.
:::

---

## Notification Channels

Routerly can send budget alerts and other notifications via email or webhook. Configure channels from **Settings → Notifications** in the dashboard, or by editing the `notifications` array in `settings.json`.

Supported providers: `smtp`, `ses`, `sendgrid`, `azure`, `google`, `webhook`.

See [Concepts: Notifications](../concepts/notifications.md) for per-provider configuration details.

---

## Full Config File Schemas

For the complete JSON schema of each configuration file, see [Reference: Config Files](../reference/config-files.md).
