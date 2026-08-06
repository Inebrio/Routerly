---
title: Environment Variables
sidebar_position: 2
---

# Environment Variables

Environment variables override corresponding settings from `settings.json` and are useful for container and CI/CD deployments.

## Runtime Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTERLY_HOME` | `~/.routerly` | Root directory for the **service** config and data (set automatically by the installer in the daemon unit). CLI auth tokens are always stored in `~/.routerly/cli/` regardless of this value. |
| `ROUTERLY_PORT` | `3000` (or from `settings.json`) | TCP port the service listens on. Overrides `port` in settings |
| `ROUTERLY_HOST` | `0.0.0.0` (or from `settings.json`) | Bind address. Overrides `host` in settings |
| `ROUTERLY_PUBLIC_URL` | `http://localhost:3000` | Externally reachable URL. Overrides `publicUrl` in settings |
| `ROUTERLY_LOG_LEVEL` | `info` | Log verbosity. Overrides `logLevel` in settings. Values: `error`, `warn`, `info`, `debug` |
| `NODE_ENV` | `development` | Set to `production` for production deployments (affects error verbosity and logging format) |

## MCP Server Variables

These variables start the [MCP server](../concepts/mcp.md)'s stdio transport.
`routerly mcp serve` sets both of them automatically when it spawns the
service binary. Set them yourself only if you are connecting a real MCP
client directly to the service binary instead of via the CLI wrapper.

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTERLY_MCP_STDIO` | unset | Set to `1` to start the stdio MCP transport on boot instead of (or in addition to) the normal HTTP server. |
| `ROUTERLY_MCP_TOKEN` | unset | Personal MCP token (`sk-rt-mcp-…`) used as the stdio session's identity; the session runs with that user's permissions. Required when `ROUTERLY_MCP_STDIO=1`. The service throws at startup if it is missing, unknown, or expired. Read by `routerly mcp serve` too, which forwards it instead of minting its own token. |

## Installer Variables

These variables are only used during the install/update process (`install.sh`, `install.ps1`, `install.mjs`) and have no effect at runtime.

| Variable | Values | Description |
|----------|--------|-------------|
| `ROUTERLY_SCOPE` | `user` (default), `system` | Install scope. `user` keeps all service config in `~/.routerly/`; `system` moves service config and data to the platform system directory (`/var/lib/routerly/` on Linux, `/Library/Application Support/Routerly/` on macOS, `C:\ProgramData\Routerly\` on Windows) and requires root/sudo. CLI auth tokens remain per-user in both cases. |
| `ROUTERLY_DAEMON` | `true`, `false` | Register as a background service after installation. Defaults to `true` |
| `ROUTERLY_INSTALL_DIR` | _(path)_ | Override the installation directory |

## Docker / Container Usage

In Docker deployments, set `ROUTERLY_HOME` to the path of your mounted volume:

```yaml
environment:
  - ROUTERLY_HOME=/data
  - NODE_ENV=production
  - ROUTERLY_PORT=3000
```

## Developer / Testing Variables

These variables are intended for local development and test environments. Do not set them in production.

| Variable | Effect |
|----------|--------|
| `ROUTERLY_TELEMETRY_DISABLED` | Any non-empty value disables all `pingTelemetry` calls. Set automatically in `vitest.config.ts` to prevent unit tests from sending real pings to `telemetry.routerly.ai`. |
| `ROUTERLY_SKIP_TRACKING` | Any non-empty value makes `appendUsageRecord` a no-op. Use when running end-to-end tests against a local service instance to keep `usage.json` clean. |

---

## Precedence

Environment variables always take precedence over values in `settings.json`. The lookup order is:

1. Environment variable (highest priority)
2. `settings.json` value
3. Built-in default (lowest priority)
