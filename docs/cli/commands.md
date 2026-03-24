---
title: Commands
sidebar_position: 2
---

# CLI Commands

Complete reference for all `routerly` CLI commands.

---

## `routerly auth`

### `routerly auth login`

Authenticate with a Routerly service and save credentials locally.

```
routerly auth login [options]
```

| Option | Description |
|--------|-------------|
| `--url <url>` | Service URL (default: value from installation) |
| `--email <email>` | Your dashboard email address |
| `--password <password>` | Your password (prompted interactively if omitted) |
| `--alias <name>` | Friendly name for this account |

If the email is already saved, you are asked whether to overwrite the existing entry or create a new one. The first account is automatically named `default`.

On success, a permanent **refresh token** is saved alongside the session token so future sessions are renewed automatically.

### `routerly auth refresh [alias]`

Manually obtain a new access token using the saved refresh token. Useful after a long suspension.

```
routerly auth refresh [alias]
```

If `alias` is omitted, the currently active account is used. Fails if no refresh token is stored (run `auth login` to re-authenticate).

### `routerly auth logout [alias]`

```
routerly auth logout [alias]
```

Removes the saved account (defaults to the active account). Removes the access token and refresh token from local storage.

### `routerly auth ps`

List all saved accounts.

```
routerly auth ps
```

The active account is marked with `*`.

### `routerly auth switch <alias>`

```
routerly auth switch <alias>
```

Sets the active account for subsequent commands.

### `routerly auth rename <old-alias> <new-alias>`

```
routerly auth rename <old-alias> <new-alias>
```

### `routerly auth whoami`

```
routerly auth whoami
```

Prints the active account alias, email, role, and server URL.

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

Project commands are organised into sub-groups. The first argument is always a **project name or ID**.

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
routerly project remove <project>
```

---

### Routing — `routerly project routing`

#### `routerly project routing show <project>`

Display the routing configuration (auto-routing flag, routing model, fallback models, and policy stack).

#### `routerly project routing update <project>`

```
routerly project routing update <project> [options]
```

| Option | Description |
|--------|-------------|
| `--routing-model <id>` | Model ID used for LLM-based routing decisions |
| `--fallback-models <ids>` | Comma-separated fallback routing model IDs |
| `--auto-routing` / `--no-auto-routing` | Enable or disable auto-routing |

#### `routerly project routing policy list <project>`

List all routing policies with their priority order, enabled status, and configuration.

#### `routerly project routing policy enable <project> <type>`

Enable a policy type (adds it to the stack if not present). Optionally pass `--config <json>` for policy-specific settings.

Available types: `health`, `context`, `capability`, `budget-remaining`, `rate-limit`, `llm`, `performance`, `fairness`, `cheapest`

```bash
routerly project routing policy enable my-api health
routerly project routing policy enable my-api llm --config '{"memoryCount":3}'
```

#### `routerly project routing policy disable <project> <type>`

Disable a policy without removing it from the stack.

#### `routerly project routing policy reorder <project> <types>`

Reorder the policy stack. Provide a comma-separated list of types in the desired evaluation order; any unlisted policies are appended at the end.

```bash
routerly project routing policy reorder my-api health,context,budget-remaining,llm,cheapest
```

---

### Models — `routerly project model`

#### `routerly project model list <project>`

List target models configured in the project, with their prompt hints.

#### `routerly project model add <project> <model-id>`

```bash
routerly project model add my-api openai/gpt-5.2
routerly project model add my-api anthropic/claude-opus-4-6 --prompt "Use for complex reasoning"
```

| Option | Description |
|--------|-------------|
| `--prompt <text>` | System prompt hint used when this model is selected |

#### `routerly project model remove <project> <model-id>`

Remove a target model from the project.

#### `routerly project model set-prompt <project> <model-id>`

Update (or clear) the system prompt hint for a model.

```bash
routerly project model set-prompt my-api openai/gpt-5.2 --prompt "Fast tasks only"
routerly project model set-prompt my-api openai/gpt-5.2 --prompt ""  # clear
```

---

### Tokens — `routerly project token`

#### `routerly project token list <project>`

List all API tokens for the project.

#### `routerly project token create <project>`

Create a new project API token. The token value is shown **once only**.

```bash
routerly project token create my-api
routerly project token create my-api --labels "production,backend"
```

| Option | Description |
|--------|-------------|
| `--labels <labels>` | Comma-separated labels for the token |

Optionally add spending limits inline:

| Option | Description |
|--------|-------------|
| `--limit <spec>` | Limit spec: `<model>:<metric>:<windowType>:<period>:<value>` (repeatable) |

Limit spec examples:
- `openai/gpt-5.2:cost:period:monthly:10` — $10/month cap
- `openai/gpt-5.2:calls:rolling:24:hours:500` — 500 calls per rolling 24 h

#### `routerly project token edit <project> <token-id>`

Add or remove limits on an existing token.

| Option | Description |
|--------|-------------|
| `--add-limit <spec>` | Add a limit (repeatable) |
| `--remove-limit <spec>` | Remove a limit matching model+metric+window (repeatable) |

#### `routerly project token remove <project> <token-id>`

Revoke and delete an API token.

---

### Members — `routerly project member`

#### `routerly project member list <project>`

List project members with their role.

#### `routerly project member add <project>`

```bash
routerly project member add my-api --email user@example.com --role viewer
```

| Option | Description |
|--------|-------------|
| `--email <email>` | Member's email address |
| `--role <role>` | Role to assign (`admin`, `editor`, `viewer`, or a custom role) |

#### `routerly project member set-role <project>`

```bash
routerly project member set-role my-api --email user@example.com --role editor
```

#### `routerly project member remove <project>`

```bash
routerly project member remove my-api --email user@example.com
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

