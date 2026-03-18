# CLI Commands Reference

Complete reference for all Routerly CLI commands.

> **Prerequisites:** the service must be running and you must be logged in (`routerly auth login`).

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
  --alias <alias>       # friendly name for this account, default: "default"
```

If `--email` or `--password` are omitted, you are prompted interactively (password input is hidden).

```bash
# Interactive login
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

### auth list

List all saved server accounts.

```bash
routerly auth list
```

### auth use

Switch the active account.

```bash
routerly auth use <alias>
```

### auth whoami

Show the currently active account and logged-in user.

```bash
routerly auth whoami
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

### model add {#model-add}

Register a new LLM model.

```bash
routerly model add \
  --id <id>              # Required. Unique model ID (e.g. gpt-4o, my-llama3)
  --provider <provider>  # Required. openai | anthropic | gemini | ollama | mistral | cohere | xai | custom
  --api-key <key>        # Provider API key (stored encrypted)
  --endpoint <url>       # Override default provider endpoint
  --input-price <usd>    # Cost per 1M input tokens in USD (auto-filled for known model IDs)
  --output-price <usd>   # Cost per 1M output tokens in USD (auto-filled for known model IDs)
  --daily-budget <usd>   # Global daily spend limit
  --monthly-budget <usd> # Global monthly spend limit
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

# Custom endpoint with budget cap
routerly model add \
  --id my-finetuned \
  --provider custom \
  --endpoint https://inference.myserver.com/v1 \
  --input-price 1.0 \
  --output-price 3.0 \
  --monthly-budget 50
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
# Basic project
routerly project add \
  --name "My App" \
  --slug my-app \
  --routing-model gpt-4o-mini \
  --models gpt-4o,claude-3-5-sonnet-20241022,llama3
```

The command prints the **project API token** (shown only once — save it).

### project remove

Remove a project by slug or ID.

```bash
routerly project remove <slug|id>
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
# Add gpt-4o to "my-app" with a $10/day limit
routerly project add-model \
  --project my-app \
  --model gpt-4o \
  --daily-budget 10
```

---

## user

Manage dashboard user accounts.

### user list

```bash
routerly user list
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

---

## role

Manage RBAC roles.

### role list

List all roles (built-in and custom).

```bash
routerly role list
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
routerly role define \
  --name "Billing Viewer" \
  --permissions "report:read,model:read,project:read"
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
routerly report calls --limit 50 --project my-app
```

Output table: Timestamp, Project, Model, In Tokens, Out Tokens, Cost, Latency, Outcome

---

## service

View and configure the running service.

### service status

Show current service configuration and statistics.

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
# Change port and enable verbose logging
routerly service configure --port 8080 --log-level debug

# Disable dashboard
routerly service configure --dashboard false
```

---

## start

Start the Routerly service directly from the CLI.

```bash
routerly start
```

This is a convenience shortcut equivalent to:
```bash
node --import tsx/esm packages/service/src/index.ts
```
