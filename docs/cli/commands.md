# CLI Commands Reference

Complete reference for all Routerly CLI commands.

> **Prerequisites:** the service must be running and you must be logged in (`routerly auth login`).

---

## status

Show a quick overview of the current session, service health, and dashboard URL. The command can be run at any time — no flags required.

```bash
routerly status [--json]
```

| Flag | Description |
|------|-------------|
| `--json` | Print output as JSON (useful for scripting/CI) |

**Human-readable output:**

```
Routerly Status

  Account:       default  (admin@example.com, role: admin)
  Server URL:    http://localhost:3000
  Token:         valid  — expires 3/20/2026, 7:13:51 PM
  Reachable:     yes
  Version:       0.0.1
  Uptime:        25h 47m
  Listening:     0.0.0.0:3000
  Dashboard:     http://localhost:3000/dashboard/
  Log level:     info
  Models:        9
  Projects:      5
```

**JSON output (`--json`):**

```json
{
  "loggedIn": true,
  "account": {
    "alias": "default",
    "email": "admin@example.com",
    "role": "admin",
    "serverUrl": "http://localhost:3000",
    "tokenValid": true,
    "tokenExpiresAt": "2026-03-20T18:13:51.000Z"
  },
  "service": {
    "reachable": true,
    "version": "0.0.1",
    "uptimeSeconds": 93147,
    "host": "0.0.0.0",
    "port": 3000,
    "listeningAddr": "0.0.0.0:3000",
    "dashboardEnabled": true,
    "dashboardUrl": "http://localhost:3000/dashboard/",
    "logLevel": "info",
    "modelCount": 9,
    "projectCount": 5
  }
}
```

If not logged in, only `{ "loggedIn": false }` is returned. If the server is unreachable, `service.reachable` is `false` and the other service fields are `null`.

```bash
# Quick health check
routerly status

# Use in scripts or CI to check reachability
routerly status --json | jq '.service.reachable'

# Get the dashboard URL
routerly status --json | jq -r '.service.dashboardUrl'
```

---

## auth

Manage connections to Routerly server instances.

### auth login

Log in to a Routerly server and save the session locally.

```bash
routerly auth login \
  --url <server-url>    # default: http://localhost:3000
  --email <email>
  --password <password>
  --alias <alias>       # friendly name for this account
```

If `--email` or `--password` are omitted, you are prompted interactively (password input is hidden).

**Alias assignment rules:**
- Only one account can use the `"default"` alias. The very first account saved gets it automatically when `--alias` is omitted.
- Subsequent accounts without `--alias` are automatically assigned an alias derived from their email address (e.g. `alice`, `alice-2`, …).
- If you attempt to add an account with an email or alias that already exists, you are prompted to overwrite the existing entry or add it as a new account.

```bash
# Interactive login (first account → alias "default")
routerly auth login --url http://localhost:3000

# Non-interactive (for scripts)
routerly auth login --url http://routerly.example.com \
  --email admin@example.com --password secret --alias prod
```

### auth logout

Remove saved credentials for an account.

```bash
routerly auth logout [--alias <alias>]
```

```bash
# Log out from the currently active account
routerly auth logout

# Log out from a specific alias
routerly auth logout --alias prod
```

### auth ps

List all saved server accounts with their alias, email, role, server URL and token expiry.

```bash
routerly auth ps
```

An arrow `→` marks the currently active account.

```
  Alias    Email                  Role   Server                        Expires
→ default  admin@example.com      admin  http://localhost:3000         01/04/2026, 12:00:00
  prod     ops@company.com        viewer http://routerly.example.com   15/04/2026, 09:30:00
```

### auth rename

Rename an existing account alias.

```bash
routerly auth rename <old-alias> <new-alias>
```

```bash
# Give the default account a more descriptive name
routerly auth rename default work

# Rename staging to prod after a promotion
routerly auth rename staging prod
```

### auth use

Switch the active account.

```bash
routerly auth use <alias>
```

```bash
routerly auth use prod
routerly auth use default
```

### auth whoami

Show the currently active account and logged-in user.

```bash
routerly auth whoami
```

```
Logged in as admin@example.com (admin)
Server:  http://localhost:3000 [default]
Expires: 01/04/2026, 12:00:00
```

---

## model

Manage registered LLM models.

### model list

List all registered models in a table.

```bash
routerly model list
```

Output columns: ID, Provider, Endpoint, Input $/1M, Output $/1M

```
  ID                          Provider   Endpoint                          Input $/1M  Output $/1M
  gpt-4o                      openai     https://api.openai.com/v1         2.50        10.00
  claude-3-5-sonnet-20241022  anthropic  https://api.anthropic.com         3.00        15.00
  llama3                      ollama     http://localhost:11434/v1         0.00        0.00
```

### model add {#model-add}

Register a new LLM model.

```bash
routerly model add \
  --id <id>                      # Required. Unique model ID (e.g. gpt-4o)
  --provider <provider>          # Required. openai | anthropic | gemini | ollama | custom
  --api-key <key>                # Provider API key
  --endpoint <url>               # Override default provider endpoint
  --input-price <usd>            # Cost per 1M input tokens (auto-filled for known IDs)
  --output-price <usd>           # Cost per 1M output tokens (auto-filled for known IDs)
  --daily-budget <usd>           # Shorthand: add a daily cost limit
  --monthly-budget <usd>         # Shorthand: add a monthly cost limit
  --limits-json <json>           # Full limits array as a JSON string
  --pricing-tiers-json <json>    # Pricing tiers array as a JSON string
  --interactive                  # Open interactive wizard for limits and pricing tiers
```

**Default endpoints by provider:**

| Provider | Default endpoint |
|----------|----------------|
| `openai` | `https://api.openai.com/v1` |
| `anthropic` | `https://api.anthropic.com` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `ollama` | `http://localhost:11434/v1` |

**Examples:**

```bash
# OpenAI (pricing preset applied automatically)
routerly model add --id gpt-4o --provider openai --api-key sk-...

# Anthropic
routerly model add \
  --id claude-3-5-sonnet-20241022 \
  --provider anthropic \
  --api-key sk-ant-...

# Ollama local model (no API key)
routerly model add --id llama3 --provider ollama --input-price 0 --output-price 0

# Custom endpoint with monthly budget
routerly model add \
  --id my-finetuned \
  --provider custom \
  --endpoint https://inference.myserver.com/v1 \
  --input-price 1.0 \
  --output-price 3.0 \
  --monthly-budget 50

# Add with explicit limits JSON (cost + call-rate limits)
routerly model add --id gpt-4o --provider openai --api-key sk-... \
  --limits-json '[{"metric":"cost","windowType":"period","period":"monthly","value":100},{"metric":"calls","windowType":"rolling","rollingAmount":1,"rollingUnit":"minute","value":60}]'

# Add with interactive wizard for limits and pricing tiers
routerly model add --id gpt-4o --provider openai --api-key sk-... --interactive
```

### model edit

Edit a registered model. Only the fields you specify are changed; everything else is preserved.

```bash
routerly model edit <id> \
  --new-id <id>                  # Rename the model ID
  --provider <provider>          # Change provider
  --endpoint <url>               # Change endpoint
  --api-key <key>                # Update API key
  --input-price <usd>            # Update input price per 1M tokens
  --output-price <usd>           # Update output price per 1M tokens
  --cache-price <usd>            # Update cache price per 1M tokens
  --context-window <tokens>      # Update context window size
  --limits-json <json>           # Replace limits array (JSON string)
  --pricing-tiers-json <json>    # Replace pricing tiers (JSON string)
  --interactive                  # Open interactive wizard for limits and pricing tiers
```

```bash
# Update just the API key
routerly model edit gpt-4o --api-key sk-new-key...

# Change pricing and add a monthly limit
routerly model edit gpt-4o --input-price 2.50 --output-price 10.00 \
  --limits-json '[{"metric":"cost","windowType":"period","period":"monthly","value":200}]'

# Rename a model
routerly model edit old-id --new-id new-id

# Edit limits interactively (preserves all other fields)
routerly model edit gpt-4o --interactive
```

### model remove

Remove a registered model by ID.

```bash
routerly model remove <id>
```

```bash
routerly model remove gpt-4o
```

---

## project

Manage Routerly projects.

### project list

List all projects.

```bash
routerly project list
```

Output columns: ID, Name, Slug, Routing Model, Models

```
  ID        Name          Slug       Routing Model  Models
  a1b2c3d4  My App        my-app     gpt-4o-mini    gpt-4o, claude-3-5-sonnet-20241022, llama3
```

### project add {#project-add}

Create a new project.

```bash
routerly project add \
  --name <name>             # Required. Human-readable project name
  --slug <slug>             # Required. URL slug (alphanumeric + dashes)
  --routing-model <id>      # Required. Model ID to use for routing decisions
  --models <ids>            # Comma-separated model IDs to associate
```

```bash
# Minimal project with one model
routerly project add \
  --name "My App" \
  --slug my-app \
  --routing-model gpt-4o-mini \
  --models gpt-4o

# Production project with multiple models (router picks the best one per request)
routerly project add \
  --name "Production API" \
  --slug production-api \
  --routing-model gpt-4o-mini \
  --models gpt-4o,claude-3-5-sonnet-20241022,llama3
```

The command prints the **project API token** (shown only once, save it).

### project remove

Remove a project by slug or ID.

```bash
routerly project remove <slug|id>
```

```bash
# By slug
routerly project remove my-app

# By ID
routerly project remove a1b2c3d4
```

### project add-model {#project-add-model}

Add a model to an existing project with optional per-project budget limits.

```bash
routerly project add-model \
  --project <slug>          # Required. Project slug or ID
  --model <id>              # Required. Model ID to add
  --daily-budget <usd>      # Per-project daily spend limit for this model
  --monthly-budget <usd>    # Per-project monthly spend limit for this model
```

```bash
# Add a model without any budget constraint
routerly project add-model \
  --project my-app \
  --model llama3

# Add with a daily cap
routerly project add-model \
  --project my-app \
  --model gpt-4o \
  --daily-budget 10

# Add with both daily and monthly caps
routerly project add-model \
  --project my-app \
  --model claude-3-5-sonnet-20241022 \
  --daily-budget 5 \
  --monthly-budget 100
```

---

## user

Manage dashboard user accounts.

### user list

```bash
routerly user list
```

```
  Email                  Role
  admin@example.com      admin
  dev@example.com        developer
```

### user add

Create a new dashboard user.

```bash
routerly user add \
  --email <email>       # Required
  --password <password> # Required
```

```bash
routerly user add --email dev@example.com --password secure123
```

### user remove

Remove a dashboard user.

```bash
routerly user remove <email>
```

```bash
routerly user remove dev@example.com
```

---

## role

Manage RBAC roles.

### role list

List all roles (built-in and custom).

```bash
routerly role list
```

```
  Name            Permissions
  admin           project:read, project:write, model:read, model:write, user:read, user:write, report:read
  viewer          project:read, model:read, report:read
  Billing Viewer  report:read, model:read, project:read
```

### role define

Create or update a custom role.

```bash
routerly role define \
  --name <name>                # Human-readable role name
  --permissions <list>         # Comma-separated permissions
```

**Available permissions:**

| Permission | Grants |
|------------|--------|
| `project:read` | View projects |
| `project:write` | Create/update/delete projects |
| `model:read` | View models |
| `model:write` | Create/update/delete models |
| `user:read` | View users |
| `user:write` | Create/update/delete users |
| `report:read` | Access usage reports |

```bash
# Read-only analyst: reports and visibility only
routerly role define \
  --name "Analyst" \
  --permissions "report:read,model:read,project:read"

# Developer: can manage models and projects but not users
routerly role define \
  --name "Developer" \
  --permissions "model:read,model:write,project:read,project:write,report:read"

# Full admin (all permissions)
routerly role define \
  --name "Admin" \
  --permissions "project:read,project:write,model:read,model:write,user:read,user:write,report:read"
```

---

## report {#report}

Generate usage and cost reports.

### report usage

Show aggregated usage grouped by model.

```bash
routerly report usage \
  --period <period>   # daily | weekly | monthly | all  (default: monthly)
  --project <id>      # Filter by project ID
```

```bash
# Monthly summary (default)
routerly report usage

# This week, filtered to one project
routerly report usage --period weekly --project my-app

# All-time
routerly report usage --period all
```

Output table: Model, Calls, Errors, Input Tokens, Output Tokens, Cost (USD)

### report calls

Show the last N individual call records.

```bash
routerly report calls \
  --limit <n>         # Number of records to show (default: 20)
  --project <id>      # Filter by project ID
```

```bash
# Last 20 calls across all projects (default)
routerly report calls

# Last 50 for a specific project
routerly report calls --limit 50 --project my-app

# Full history for a project (high limit)
routerly report calls --limit 1000 --project production-api
```

Output table: Timestamp, Project, Model, In Tokens, Out Tokens, Cost, Latency, Outcome

---

## service

View and configure the running service.

### service status

Show current service configuration and statistics. For a combined session + service overview, prefer the top-level [`routerly status`](#status) command.

```bash
routerly service status
```

Output:
```
Routerly Service Status

  Server:        http://localhost:3000
  Version:       0.0.1
  Uptime:        12m 34s
  Port:          3000
  Host:          127.0.0.1
  Dashboard:     enabled
  Log level:     info
  Timeout:       60000ms
  Models:        4
  Projects:      2
```

### service configure

Update service settings. Changes take effect on the next service restart.

```bash
routerly service configure \
  --port <n>              # TCP port
  --host <host>           # Bind address (0.0.0.0 for all interfaces)
  --dashboard <bool>      # true | false
  --log-level <level>     # trace | debug | info | warn | error
  --timeout <ms>          # Default per-model request timeout
```

```bash
# Change port only
routerly service configure --port 8080

# Change port and enable verbose logging during development
routerly service configure --port 8080 --log-level debug

# Expose on all interfaces (useful inside Docker/VMs)
routerly service configure --host 0.0.0.0 --port 3000

# Production hardening: disable dashboard, quieter logs, shorter timeout
routerly service configure --dashboard false --log-level warn --timeout 30000
```


