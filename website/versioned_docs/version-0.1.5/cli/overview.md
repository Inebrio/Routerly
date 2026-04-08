---
title: CLI Overview
sidebar_position: 1
---

# CLI Overview

The `routerly` CLI lets you manage all aspects of a Routerly instance from the terminal — models, projects, users, usage reports, and service configuration. It communicates with the running Routerly service via its management API.

---

## Installation

The CLI is installed automatically by the Routerly installer. Verify it is available:

```bash
routerly --version
```

---

## Authentication

The CLI needs credentials to connect to a Routerly service. Authenticate with:

```bash
routerly auth login --url http://localhost:3000 --email admin@example.com
```

You will be prompted for your password. On success, a JWT session token is saved in `~/.routerly/cli/auth.json`.

### Multiple Accounts

You can manage multiple Routerly instances with named aliases:

```bash
routerly auth login \
  --url https://routerly.example.com \
  --email admin@example.com \
  --alias production

routerly auth login \
  --url http://localhost:3000 \
  --email dev@example.com \
  --alias local
```

Switch between accounts with:

```bash
routerly auth switch --alias production
```

Rename an alias:

```bash
routerly auth rename --alias local --new-alias dev
```

List all saved accounts:

```bash
routerly auth list
```

Log out:

```bash
routerly auth logout              # logs out the active account
routerly auth logout --alias production   # logs out a specific account
```

---

## Current Service Status

```bash
routerly status
```

Prints: service URL, version, uptime, and whether the service is reachable. Add `--json` for machine-readable output.

---

## Global Options

| Option | Description |
|--------|-------------|
| `--alias <name>` | Use a specific saved account instead of the active one |
| `--url <url>` | Connect to this service URL (overrides the saved account) |
| `--json` | Output as JSON (available on most commands) |
| `--help` | Show help |
| `--version` | Print CLI version |

---

## Command Groups

| Group | Description |
|-------|-------------|
| `routerly auth` | Authentication and account management |
| `routerly model` | Register and manage LLM models |
| `routerly project` | Create and manage projects |
| `routerly user` | Manage dashboard users |
| `routerly role` | Manage RBAC roles |
| `routerly report` | Usage and billing reports |
| `routerly service` | Service configuration |
| `routerly status` | Check service reachability |

See [CLI: Commands](./commands.md) for the full reference.
