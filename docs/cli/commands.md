---
title: Commands
sidebar_position: 2
---

# CLI Commands

Complete reference for all `routerly` CLI commands.

---

## `routerly auth`

### `routerly auth login`

Authenticate with a Routerly service and save credentials.

```
routerly auth login [options]
```

| Option | Description |
|--------|-------------|
| `--url <url>` | Service URL (e.g. `http://localhost:3000`) |
| `--email <email>` | Your dashboard email address |
| `--alias <name>` | Name for this account (default: `default`) |

You will be prompted for your password interactively.

### `routerly auth logout`

```
routerly auth logout [--alias <name>]
```

### `routerly auth list`

List all saved accounts.

### `routerly auth switch`

```
routerly auth switch --alias <name>
```

### `routerly auth rename`

```
routerly auth rename --alias <current> --new-alias <new>
```

---

## `routerly model`

### `routerly model list`

```
routerly model list [--json]
```

### `routerly model add`

```
routerly model add [options]
```

| Option | Description |
|--------|-------------|
| `--id <id>` | Model identifier (e.g. `gpt-5-mini`) |
| `--provider <provider>` | Provider ID: `openai`, `anthropic`, `gemini`, `mistral`, `cohere`, `xai`, `ollama`, `custom` |
| `--api-key <key>` | Provider API key |
| `--base-url <url>` | Override provider endpoint |
| `--input-price <price>` | Input price per 1M tokens (USD) |
| `--output-price <price>` | Output price per 1M tokens (USD) |
| `--context-window <n>` | Max context window tokens |

Calling without options launches an interactive wizard.

### `routerly model edit`

```
routerly model edit --id <id> [field options]
```

Same options as `add`. Only specified fields are updated.

### `routerly model remove`

```
routerly model remove --id <id>
```

---

## `routerly project`

### `routerly project list`

```
routerly project list [--json]
```

### `routerly project add`

```
routerly project add [options]
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Project display name |
| `--slug <slug>` | URL-safe identifier (must be unique) |
| `--models <ids>` | Comma-separated list of model IDs to assign |
| `--timeout <ms>` | Default request timeout in ms |

### `routerly project remove`

```
routerly project remove --slug <slug>
```

### `routerly project add-model`

Add a model to a project's routing configuration. Optionally set budget limits.

```
routerly project add-model --slug <slug> --model <id> [budget options]
```

| Option | Description |
|--------|-------------|
| `--slug <slug>` | Project slug |
| `--model <id>` | Model ID to add |
| `--daily-budget <usd>` | Daily cost limit in USD |
| `--monthly-budget <usd>` | Monthly cost limit in USD |

### `routerly project remove-model`

```
routerly project remove-model --slug <slug> --model <id>
```

---

## `routerly user`

### `routerly user list`

```
routerly user list [--json]
```

### `routerly user add`

```
routerly user add --email <email> --role <role>
```

You will be prompted for the new user's password.

### `routerly user remove`

```
routerly user remove --email <email>
```

---

## `routerly role`

### `routerly role list`

```
routerly role list [--json]
```

### `routerly role add`

```
routerly role add --name <name> --permissions <perm1,perm2,...>
```

Available permissions: `project:read`, `project:write`, `model:read`, `model:write`, `user:read`, `user:write`, `report:read`.

### `routerly role edit`

```
routerly role edit --name <name> --permissions <perm1,perm2,...>
```

### `routerly role remove`

```
routerly role remove --name <name>
```

---

## `routerly report`

### `routerly report usage`

Aggregated usage summary grouped by model.

```
routerly report usage [options]
```

| Option | Description |
|--------|-------------|
| `--period <period>` | `daily`, `weekly`, `monthly` (default: `monthly`) |
| `--project <slug>` | Filter to one project |
| `--json` | JSON output |

### `routerly report calls`

Recent request log.

```
routerly report calls [options]
```

| Option | Description |
|--------|-------------|
| `--limit <n>` | Number of records to return (default: 20) |
| `--project <slug>` | Filter to one project |
| `--json` | JSON output |

---

## `routerly service`

### `routerly service status`

```
routerly service status [--json]
```

Same as `routerly status`.

### `routerly service configure`

```
routerly service configure [options]
```

| Option | Description |
|--------|-------------|
| `--port <n>` | Service port |
| `--host <host>` | Bind address |
| `--dashboard <bool>` | Enable/disable web dashboard |
| `--log-level <level>` | `trace` / `debug` / `info` / `warn` / `error` |
| `--timeout <ms>` | Global default request timeout |
| `--public-url <url>` | External URL of the service |

---

## `routerly status`

```
routerly status [--json]
```

Check whether the active Routerly service is reachable. Prints URL, version, and uptime. Exit code `0` if the service is up, `1` otherwise.


