---
title: Environment Variables
sidebar_position: 2
---

# Environment Variables

Environment variables override corresponding settings from `settings.json` and are useful for container and CI/CD deployments.

## Runtime Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTERLY_HOME` | `~/.routerly` | Root directory for all Routerly data (config, data, app binaries) |
| `ROUTERLY_PORT` | `3000` (or from `settings.json`) | TCP port the service listens on. Overrides `port` in settings |
| `ROUTERLY_HOST` | `0.0.0.0` (or from `settings.json`) | Bind address. Overrides `host` in settings |
| `ROUTERLY_PUBLIC_URL` | `http://localhost:3000` | Externally reachable URL. Overrides `publicUrl` in settings |
| `ROUTERLY_LOG_LEVEL` | `info` | Log verbosity. Overrides `logLevel` in settings. Values: `error`, `warn`, `info`, `debug` |
| `NODE_ENV` | `development` | Set to `production` for production deployments (affects error verbosity and logging format) |

## Installer Variables

These variables are only used during the install/update process (`install.sh`, `install.ps1`, `install.mjs`) and have no effect at runtime.

| Variable | Values | Description |
|----------|--------|-------------|
| `ROUTERLY_SCOPE` | `user` (default), `system` | Install scope. `user` installs to `~/.routerly`; `system` installs to `/opt/routerly` (requires root) |
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

## Precedence

Environment variables always take precedence over values in `settings.json`. The lookup order is:

1. Environment variable (highest priority)
2. `settings.json` value
3. Built-in default (lowest priority)
