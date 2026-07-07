---
title: Commands
sidebar_position: 2
---

# CLI Commands

Complete reference for all `routerly` CLI commands.

---

## `routerly catalog`

Manage the provider catalog repositories and cache.

### `routerly catalog repos list`

```
routerly catalog repos list [--json]
```

List all configured provider repositories with their status.

**Columns:**
- **#** — priority (1 = checked first)
- **URL** — repository endpoint
- **File** — name of the last successfully resolved catalog file
- **Updated** — timestamp from the catalog (when the snapshot was created)
- **Last Check** — when Routerly last fetched from this repo
- **Status** — Active / Disabled / Error (with error details on hover or in JSON)

The default repo (Inebrio) is always present. Additional repos are appended at lower priority.

### `routerly catalog repos add`

```
routerly catalog repos add <url>
```

Add a new repository to the list. The repo is appended at the end (lowest priority). It is enabled by default.

```bash
routerly catalog repos add https://your-org.com/catalog/
```

### `routerly catalog repos remove`

```
routerly catalog repos remove <url>
```

Remove a repository by URL. Requires `settings:write` permission.

```bash
routerly catalog repos remove https://your-org.com/catalog/
```

### `routerly catalog repos enable`

```
routerly catalog repos enable <url>
```

Enable a previously disabled repository.

### `routerly catalog repos disable`

```
routerly catalog repos disable <url>
```

Disable a repository without removing it from the list. Disabled repos are not fetched.

### `routerly catalog refresh`

```
routerly catalog refresh
```

Invalidate the in-memory catalog cache and fetch all enabled repositories immediately. Useful after adding a new repo or when you know the catalog has been updated.

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

**Columns:**
- **ID** — model identifier
- **Provider** — provider name
- **Endpoint** — base URL (custom endpoint or provider default)
- **Catalog** — tracking status: `(catalog)` (auto-synced), `(partial override)` (some fields locked), or empty (no catalog entry)

---

### `routerly model show`

```
routerly model show <id> [--json]
```

Display all details of a model, including pricing, context window, capabilities, and (if applicable) catalog tracking status.

**Output includes:**
- Model configuration (ID, provider, endpoint, API key status, enabled flag)
- Pricing (input/output/cache rates, pricing tiers, context window)
- Capabilities (vision, function calling, JSON mode, embeddings)
- Catalog tracking section (only if the model is linked to a catalog entry):
  - **Auto-synced fields** — fields currently tracking the catalog
  - **Overridden fields** — locked fields with their catalog defaults shown
  - **Last synced** — timestamp of the most recent auto-sync

```bash
routerly model show gpt-5-mini
routerly model show gpt-5-mini --json
```

---

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

### `routerly model discover`

Browse the built-in model catalog with capabilities and pricing.

```
routerly model discover [options]
```

| Option | Description |
|--------|-------------|
| `--provider <name>` | Filter by provider (`openai`, `anthropic`, `gemini`, `ollama`, …) |
| `--json` | Output raw JSON |

Displays a table of known models with their context window, modalities, and pricing. Models already configured in your Routerly instance are marked with a `★`.

Pricing is shown as the per-1,000-token rate. Models that carry a `local` flag in the catalog **or** that are zero-priced on both input and output are labelled `free/local` in green — this covers Ollama and other self-hosted models regardless of whether the catalog explicitly marks them as local.

If the server does not yet expose the model catalog (older versions), the command exits gracefully with a message instead of an error.

```bash
routerly model discover
routerly model discover --provider anthropic
routerly model discover --json
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

List all API tokens for the project, including their names, IDs, creation date, and tags.

```bash
routerly project token list my-api
```

Output includes columns for:
- **Name** — token name
- **ID** — token identifier (first 8 characters)
- **Created** — when the token was created
- **Tags** — key-value metadata (comma-separated, or empty if no tags)

#### `routerly project token create <project>`

Create a new project API token. The token value is shown **once only**.

```bash
routerly project token create my-api
routerly project token create my-api --tag environment=prod --tag team=backend
```

| Option | Description |
|--------|-------------|
| `--tag <key=value>` | Attach key-value metadata to the token (repeatable). Tags are included in every usage record created with this token. |

Optionally add spending limits inline:

| Option | Description |
|--------|-------------|
| `--limit <spec>` | Limit spec: `<model>:<metric>:<windowType>:<period>:<value>` (repeatable) |

Limit spec examples:
- `openai/gpt-5.2:cost:period:monthly:10` — $10/month cap
- `openai/gpt-5.2:calls:rolling:24:hours:500` — 500 calls per rolling 24 h

#### `routerly project token edit <project> <token-id>`

Update tags or spending limits on an existing token.

```bash
routerly project token edit my-api abc123 --tag environment=staging --tag team=qa
```

| Option | Description |
|--------|-------------|
| `--tag <key=value>` | Replace all tags with these key-value pairs (repeatable). Omit to keep existing tags unchanged. |
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

### Guardrails — `routerly project guardrails`

Manage the content guardrail configuration for a project. Guardrails evaluate each request and/or response against an ordered list of rules; each enabled rule is evaluated and triggers its configured block and/or log actions independently.

#### `routerly project guardrails <project>`

Show the current guardrail configuration.

```bash
routerly project guardrails my-api
routerly project guardrails my-api --json   # raw JSON output
```

Output example:

```
Guardrails - my-api
Detect Injection: yes

Active Security Rules:
  #   Type          Target      Summary
  0   regex         request     2 pattern(s) [block]
  1   semantic      both        model: text-embedding-3-small, 3 example(s) [log]
  2   topic         response    model: claude-haiku-4-5 [block+log] [judge-response]
  3   moderation    request     model: claude-haiku-4-5 [block]
```

The summary suffix shows action tags:
- `[block]`: the rule blocks on trigger
- `[log]`: the rule logs trigger in usage (monitor)
- `[block+log]`: the rule both blocks and logs
- `[judge-response]`: the rule uses the judge model's message as the block reply

#### Detect Injection

```bash
routerly project guardrails my-api --detect-injection
routerly project guardrails my-api --no-detect-injection
```

| Option | Description |
|--------|-------------|
| `--detect-injection` | Enable built-in prompt-injection detector (blocks and logs on hit) |
| `--no-detect-injection` | Disable prompt-injection detector |

#### Adding a security rule

```bash
routerly project guardrails my-api --add-rule
```

Launches an interactive wizard. Steps:

1. **Rule type**: choose from:
   - `regex`: block requests/responses matching regex patterns
   - `semantic`: block semantically similar content using embeddings
   - `topic`: block off-topic requests using an LLM judge
   - `moderation`: detect harmful content using an LLM judge

2. **Target**: `request`, `response`, or `both`

3. **Block and Log**: independent checkboxes.
   - Block: reject when this rule triggers (default: true on add)
   - Log: record the trigger in usage (default: false on add)

4. **Block Message**: custom message returned when the rule blocks (prompted only if Block is enabled). Leave empty for built-in default.

5. **Judge Response**: (topic/moderation only, when Block is enabled) use the judge model's own explanation as the block message. When true, the judge is asked to return `{ score, message }` and the message is returned on block, with the static Block Message as fallback if the judge fails.

6. **Type-specific fields**: prompts depend on the rule type selected.

New rules are appended to the end of the list and are active by default.

#### Removing a security rule

```bash
routerly project guardrails my-api --remove-rule 2   # delete rule at index 2
```

| Option | Description |
|--------|-------------|
| `--remove-rule <index>` | Remove the security rule at 0-based index |

---

### PII: `routerly project pii`

Manage PII scrubbing policies for a project. PII detection and scrubbing configuration uses named policies, each with its own entity set, patterns, direction, and streaming buffer.

#### `routerly project pii list <project>`

List all PII policies for a project.

```bash
routerly project pii list my-api
routerly project pii list my-api --json
```

Output example:

```
PII Policies - my-api
  #   Name               Enabled   Target     Entities
  0   default            yes       both       EMAIL, PHONE, CREDIT_CARD, SSN, IBAN
  1   pii-request-only   yes       request    EMAIL, PHONE
```

#### `routerly project pii add <project>`

Add a new PII policy.

```bash
routerly project pii add my-api
```

Launches an interactive wizard. Steps:

1. **Policy name**: unique identifier for this policy
2. **Target**: `request`, `response`, or `both` (which side(s) to scrub)
3. **Entities**: comma-separated list of entity types to detect (EMAIL, PHONE, CREDIT_CARD, SSN, IBAN). Leave empty to include none.
4. **Custom patterns**: comma-separated regex patterns to scrub in addition to entity detection. Leave empty for none.
5. **Output buffer size**: (response scrubbing only) suffix buffer size in characters (default 30, valid range: 10 to 500). Used to catch patterns spanning chunk boundaries when streaming. Prompted only when target includes response.

#### `routerly project pii remove <project> <policy-name>`

Remove a PII policy by name.

```bash
routerly project pii remove my-api default
```

---

## `routerly integrations`

Manage metric export integrations for external observability platforms.

### `routerly integrations list`

```
routerly integrations list [--json]
```

Lists all configured integrations in a table with ID (truncated), Type, Enabled status, and Name/Endpoint.

**Table columns:**
- **ID** — integration UUID (first 8 chars)
- **Type** — provider type (prometheus, otel, datadog, grafana, influxdb, webhook)
- **Enabled** — yes/no status
- **Name/Endpoint** — friendly name or primary identifier

**JSON output:**
```json
{
  "integrations": [
    {
      "id": "int-uuid",
      "type": "prometheus",
      "enabled": true,
      "name": "Prometheus"
    },
    {
      "id": "int-uuid2",
      "type": "datadog",
      "enabled": true,
      "name": "Datadog Prod",
      "apiKey": null,
      "site": "datadoghq.com"
    }
  ]
}
```

### `routerly integrations add`

```
routerly integrations add --type <type> [options]
```

Creates a new integration. Type-specific options vary. Without options, launches an interactive wizard.

| Option | Description |
|--------|-------------|
| `--type <type>` | Required. One of: `prometheus`, `otel`, `datadog`, `grafana`, `influxdb`, `webhook` |
| `--name <name>` | Friendly name (prompted if omitted) |

**Type-specific options:**

**Prometheus** (pull-based, optional auth):
```bash
routerly integrations add --type prometheus --name "Prometheus" --auth-token my-token
```

| Option | Description |
|--------|-------------|
| `--auth-token <token>` | Optional bearer token for `/metrics` endpoint auth |

**OpenTelemetry** (push):
```bash
routerly integrations add --type otel --name "OTEL Collector" \
  --endpoint http://localhost:4318/v1/metrics \
  --protocol http \
  --header "Authorization: Bearer token" \
  --header "X-Custom: value"
```

| Option | Description |
|--------|-------------|
| `--endpoint <url>` | Required. OTLP receiver endpoint (e.g. `http://localhost:4318/v1/metrics`) |
| `--protocol <proto>` | Required. `http` or `grpc` (default: `http`) |
| `--header <key=value>` | Optional custom header (repeatable, format: `Key: Value`) |

**Datadog** (push):
```bash
routerly integrations add --type datadog --name "Datadog Prod" \
  --api-key dd_key_123 \
  --site datadoghq.com
```

| Option | Description |
|--------|-------------|
| `--api-key <key>` | Required. Datadog API key |
| `--site <site>` | Site identifier (default: `datadoghq.com`). Options: `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`, `us5.datadoghq.com`, `ddog-gov.com` |

**Grafana Cloud** (push):
```bash
routerly integrations add --type grafana --name "Grafana" \
  --url https://prometheus-blocks-prod-us-central1.grafana.net/api/prom/push \
  --username 123456 \
  --api-key glc_key_123
```

| Option | Description |
|--------|-------------|
| `--url <url>` | Required. Prometheus remote_write endpoint |
| `--username <id>` | Required. Numeric Grafana Cloud instance ID |
| `--api-key <key>` | Required. Grafana Cloud API key |

**InfluxDB** (push):
```bash
routerly integrations add --type influxdb --name "InfluxDB" \
  --url http://localhost:8086 \
  --token influx_token_123 \
  --org routerly \
  --bucket metrics
```

| Option | Description |
|--------|-------------|
| `--url <url>` | Required. InfluxDB server URL |
| `--token <token>` | Required. InfluxDB API token |
| `--org <org>` | Required. Organization name |
| `--bucket <bucket>` | Required. Target bucket name |

**Webhook** (push):
```bash
routerly integrations add --type webhook --name "Webhook" \
  --url https://example.com/metrics \
  --secret signing_secret_123 \
  --header "X-Custom: value"
```

| Option | Description |
|--------|-------------|
| `--url <url>` | Required. HTTPS endpoint for metric POST requests |
| `--secret <secret>` | Optional. If set, requests are HMAC-SHA256 signed (header: `X-Routerly-Signature`) |
| `--header <key=value>` | Optional custom header (repeatable, format: `Key: Value`) |

### `routerly integrations remove`

```
routerly integrations remove <id>
```

Deletes an integration by ID. Prompts for confirmation.

| Parameter | Description |
|-----------|-------------|
| `<id>` | Integration ID (full UUID or first 8 chars) |

### `routerly integrations test`

```
routerly integrations test <id>
```

Tests connectivity to the external system. For Prometheus (pull-based), the test is a no-op. For push-based integrations, sends a real metric payload and reports success or error.

| Parameter | Description |
|-----------|-------------|
| `<id>` | Integration ID (full UUID or first 8 chars) |

**Output:**
```
Testing integration int-uuid2 (Datadog)...
✓ Connection successful
```

Or on failure:
```
✗ Connection failed: HTTP 401 Unauthorized
```

### `routerly integrations enable`

```
routerly integrations enable <id>
```

Activates an integration (sets `enabled: true`). Metric pushes resume.

| Parameter | Description |
|-----------|-------------|
| `<id>` | Integration ID |

### `routerly integrations disable`

```
routerly integrations disable <id>
```

Pauses an integration (sets `enabled: false`). Metric pushes stop without deleting the configuration.

| Parameter | Description |
|-----------|-------------|
| `<id>` | Integration ID |

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

Available permissions: `project:read`, `project:write`, `model:read`, `model:write`, `user:read`, `user:write`, `role:write`, `report:read`, `audit:read`, `settings:read`, `settings:write`, `notification:write`, `token:read`, `token:write`.

### `routerly role edit`

```
routerly role edit --name <name> --permissions <perm1,perm2,...>
```

### `routerly role remove`

```
routerly role remove --name <name>
```

---

## `routerly audit`

### `routerly audit list`

List audit log entries.

```
routerly audit list [options]
```

| Option | Description |
|--------|-------------|
| `--user <email>` | Filter by user email or ID |
| `--action <str>` | Filter by action substring (e.g. `model:create`) |
| `--from <date>` | Start date (ISO format, e.g. `2026-01-01`) |
| `--to <date>` | End date (ISO format, e.g. `2026-12-31`) |
| `--limit <n>` | Max entries to return (default: 50) |
| `--json` | Output raw JSON |

Examples:

```
routerly audit list
routerly audit list --user admin@example.com --limit 20
routerly audit list --action model:create --json
routerly audit list --from 2026-01-01 --to 2026-06-30
```

Requires `audit:read` permission.

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
| `--session-id <id>` | Filter by session ID |
| `--end-user <id>` | Filter by end-user ID |
| `--tag <key=value>` | Filter by tag |
| `--json` | JSON output |

The footer line below the model table shows a summary and a **callType breakdown**:

```
Total: $0.001234 USD (142 ok, 2 errors, 3 blocked)
Breakdown — completion: 142 calls / $0.001200  |  routing: 8 calls / $0.000011  |  guardrail: 12 calls / $0.000023  |  blocked: 3 calls
```

The summary suffix `, N blocked` appears when at least one request was blocked by a guardrail rule. Blocked requests contribute zero cost. The breakdown line includes a `blocked: N calls` entry for the same count.

The `--json` output includes these fields in `summary`:

| Field | Type | Description |
|-------|------|-------------|
| `guardrailCalls` | number | Model calls made by the guardrail pipeline (embedding, topic, moderation judges) |
| `guardrailCost` | number | USD cost of guardrail judge calls |
| `blockedCalls` | number | Requests blocked before reaching a model (zero cost) |

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

### `routerly report end-users`

Lists end-users with their usage attributed to a project.

```
routerly report end-users [options]
```

| Option | Description |
|--------|-------------|
| `--project <id>` | Filter by project ID (optional) |
| `--json` | JSON output |

Displays a table with columns: User ID, Requests, Tokens, Cost, First Seen, Last Seen.

Requires `report:read` permission.

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

## `routerly update`

Manage Routerly version channels and trigger in-app updates.

### `routerly update check`

Check whether a newer version is available on the current channel.

```
routerly update check [--json]
```

| Option | Description |
|--------|-------------|
| `--json` | Print output as JSON for scripting |

Prints the current version, the latest version available on the active channel, and when the last check was performed. Exit code `0` in all cases (use `--json` and parse `available` for scripting).

```bash
routerly update check
#   Routerly v0.2.0 is up to date.
#   Channel: stable   Checked: 6/9/2026, 10:00:00 AM

routerly update check --json
```

### `routerly update channel [name]`

Show or change the update channel.

```
routerly update channel [name]
```

With no argument, prints the current channel. With an argument, updates the channel immediately — the running service is notified without a restart.

Valid values:

| Value | Description |
|-------|-------------|
| `latest` | Most recent release (may include pre-releases) |
| `stable` | Most recent production-stable release |
| `develop` | Development pre-release builds |
| `vX.Y.Z` | Pin to a specific version tag (e.g. `v0.2.0`) |

```bash
routerly update channel           # show current channel
routerly update channel latest    # switch to latest
routerly update channel stable    # switch to stable
routerly update channel develop   # switch to develop (pre-releases)
routerly update channel v0.2.0    # pin to a specific version
```

Changing the channel to a version tag sets the channel to `custom` internally and disables automatic update notifications for that version.

### `routerly update run`

Trigger an in-app update to the newest version on the current channel.

```
routerly update run [--yes]
```

| Option | Description |
|--------|-------------|
| `--yes` | Skip the interactive confirmation prompt |

The service downloads and installs the update in the background, then restarts automatically. The CLI polls `/health` for up to 60 seconds and prints a confirmation when the service comes back online.

```bash
routerly update run          # interactive confirmation
routerly update run --yes    # non-interactive (for scripts)
```

:::note Requirements
Admin role required. Not available inside Docker containers — pull the new image and recreate the container instead. Not available on Windows — run the installer script manually.
:::

---

## `routerly notification`

Manage the in-app notification inbox and delivery channels.

### `routerly notification list`

```
routerly notification list [--json] [--from <date>] [--to <date>]
```

List the 50 most recent inbox notifications. Results are newest-first.

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON array |
| `--from <date>` | Only items on or after this date (YYYY-MM-DD or ISO 8601) |
| `--to <date>` | Only items on or before this date (YYYY-MM-DD or ISO 8601) |

```bash
routerly notification list
routerly notification list --from 2026-06-01 --to 2026-06-30
routerly notification list --json
```

### `routerly notification show <id>`

```
routerly notification show <id> [--json]
```

Show a single notification with all details (including the `details` object). Secrets are masked.

```bash
routerly notification show 8f3c… --json
```

### `routerly notification read [id]`

```
routerly notification read [id]
```

Mark a notification as read. Omit `<id>` to mark all as read.

```bash
routerly notification read 8f3c…
routerly notification read  # mark all as read
```

### `routerly notification unread [id]`

```
routerly notification unread [id]
```

Mark a notification as unread (inverse of `read`). Omit `<id>` to mark all as unread.

```bash
routerly notification unread 8f3c…
routerly notification unread  # mark all as unread
```

### `routerly notification delete [ids...]`

```
routerly notification delete [<id> ...] [--all] [--json]
```

Dismiss (delete) one or more notifications from your inbox. Deletion is per-user only; other users' copies remain.

| Option | Description |
|--------|-------------|
| `<id> ...` | One or more notification IDs to delete |
| `--all` | Delete all notifications in your inbox |
| `--json` | Output the delete count as JSON |

```bash
routerly notification delete 8f3c…
routerly notification delete 8f3c… 1a2b… 3c4d…
routerly notification delete --all
routerly notification delete --all --json
```

### `routerly notification channel list`

```
routerly notification channel list [--json]
```

List all configured notification channels. The table columns are: **Name**, **Type**, **Config**, **Events** (patterns routed to this channel, `*` = all), and **Targets** (who receives - `everyone` when unset).

```bash
routerly notification channel list
routerly notification channel list --json
```

### `routerly notification channel show <id>`

```
routerly notification channel show <id> [--json]
```

Show a single channel with all configuration fields (secrets are masked and shown as `*** (configured)`).

```bash
routerly notification channel show abc-uuid
routerly notification channel show abc-uuid --json
```

### `routerly notification channel add`

```
routerly notification channel add --type <type> --name <name> [options]
```

Add a notification channel.

| Flag | Required | Description |
|------|----------|-------------|
| `--type <type>` | yes | `dashboard`, `smtp`, `ses`, `sendgrid`, `azure`, `google`, `webhook`, `slack`, `teams`, `pagerduty`, `discord` |
| `--name <name>` | yes | Friendly label shown in the UI |
| `--events <patterns>` | no | Comma-separated event patterns this channel receives (e.g. `budget.*,model.added`). Omit for all events. |
| `--target-roles <roles>` | no | Comma-separated role IDs to target. Omit for everyone. |
| `--target-permissions <perms>` | no | Comma-separated permission names to target. |
| `--target-users <users>` | no | Comma-separated user IDs to target. |

**Provider-specific flags:**
| Provider | Flags |
|----------|-------|
| `slack` | `--bot-token` (xoxb-…), `--channel-id` |
| `teams` / `discord` | `--webhook-url` |
| `pagerduty` | `--integration-key` |
| `dashboard` | (no additional flags) |
| `smtp` | `--host`, `--port`, `--from-address`, `--from-name`, `--username`, `--password` |
| `ses` | `--region`, `--access-key-id`, `--secret-access-key` |
| `sendgrid` | `--api-key` |
| `azure` | `--connection-string` |
| `google` | `--client-id`, `--client-secret`, `--refresh-token` |
| `webhook` | `--url`, `--method` (POST or GET), `--secret` |

```bash
# In-app inbox channel: budget events to admin role only
routerly notification channel add \
  --type dashboard --name "Budget Alerts" \
  --events "budget.*" \
  --target-roles "admin"

# Slack channel for all events, everyone
routerly notification channel add \
  --type slack --name "ops-alerts" \
  --bot-token xoxb-... --channel-id C1234567890

# SMTP channel for provider errors to operators
routerly notification channel add \
  --type smtp --name "Email Alerts" \
  --host smtp.example.com --port 587 \
  --from-address "alerts@example.com" \
  --username "user@example.com" \
  --password "secret" \
  --events "provider.error,provider.degraded" \
  --target-roles "operator"
```

### `routerly notification channel show <id>`

```
routerly notification channel show <id> [--json]
```

Display channel details. Secrets are masked as `*** (configured)` or `(not set)`.

### `routerly notification channel edit <id>`

```
routerly notification channel edit <id> [options]
```

Edit a channel's configuration. Only provided options are updated; omitted options are left unchanged. Secret fields are only updated when explicitly provided and non-empty.

| Flag | Description |
|------|-------------|
| `--name <name>` | New friendly name |
| `--events <patterns>` | Comma-separated event patterns (empty string to clear all) |
| `--target-roles <roles>` | Comma-separated role IDs |
| `--target-permissions <perms>` | Comma-separated permission names |
| `--target-users <users>` | Comma-separated user IDs |
| `--host <host>` | SMTP host |
| `--port <port>` | SMTP port |
| `--from-address <addr>` | From email address |
| `--from-name <name>` | From display name |
| `--username <user>` | SMTP username |
| `--password <pass>` | SMTP password (secret) |
| `--region <region>` | AWS region (SES) |
| `--access-key-id <id>` | AWS access key ID (SES) |
| `--secret-access-key <key>` | AWS secret key (SES, secret) |
| `--api-key <key>` | SendGrid API key (secret) |
| `--connection-string <str>` | Azure connection string (secret) |
| `--client-id <id>` | Google client ID |
| `--client-secret <secret>` | Google client secret (secret) |
| `--refresh-token <token>` | Google refresh token (secret) |
| `--url <url>` | Webhook URL |
| `--method <method>` | HTTP method (POST or GET) |
| `--secret <secret>` | HMAC signing secret (secret) |
| `--bot-token <token>` | Slack bot token (secret) |
| `--channel-id <id>` | Slack channel ID |
| `--webhook-url <url>` | Webhook URL (Teams/Discord, secret) |
| `--integration-key <key>` | PagerDuty integration key (secret) |

```bash
routerly notification channel edit abc-uuid --name "Updated Name"
routerly notification channel edit abc-uuid --events "budget.*" --target-roles "admin,operator"
routerly notification channel edit abc-uuid --password "new_secret"
```

### `routerly notification channel delete <id>`

```
routerly notification channel delete <id>
```

Delete a channel by ID. Use `channel list --json` to find IDs.

```bash
routerly notification channel delete abc-uuid
```

### `routerly notification channel test <id>`

```
routerly notification channel test <id> [--to <email>]
```

Send a test notification through the channel.

| Option | Description |
|--------|-------------|
| `--to <email>` | Override recipient for email-provider channels (defaults to your account email) |

```bash
routerly notification channel test abc-uuid
routerly notification channel test abc-uuid --to test@example.com
```

### `routerly notification rules`

Manage notification routing rules. Routing rules map event patterns to one or more channels; matching events are dispatched to those channels.

#### `routerly notification rules list`

```
routerly notification rules list [--json]
```

List all configured routing rules.

```bash
routerly notification rules list
routerly notification rules list --json
```

Output example:
```
#   Events                        Channels
1   provider.error, provider.degraded   webhook-ops
2   budget.*                      smtp-admin
```

#### `routerly notification rules add`

```
routerly notification rules add --events <patterns> --channels <ids> [--json]
```

Add a new routing rule.

| Option | Description |
|--------|-------------|
| `--events <patterns>` | Comma-separated event patterns (e.g. `budget.*,provider.error`). Supports exact names, wildcards, and prefix globs |
| `--channels <ids>` | Comma-separated channel IDs to route matching events to |
| `--json` | Output all rules as JSON after adding |

```bash
routerly notification rules add --events "provider.error,provider.degraded" --channels "webhook-ops"
routerly notification rules add --events "budget.*" --channels "smtp-admin,slack-ops"
```

#### `routerly notification rules delete`

```
routerly notification rules delete <index>
```

Delete a routing rule by its 1-based index (as shown in `list`).

```bash
routerly notification rules delete 1
```

### `routerly notification cooldowns`

Manage notification cooldown intervals. Cooldowns suppress repeated dispatches of the same event type within a time window. Suppressed events are still recorded in the inbox and logs; they are simply not sent to external channels.

#### `routerly notification cooldowns list`

```
routerly notification cooldowns list [--json]
```

List all configured cooldowns.

```bash
routerly notification cooldowns list
routerly notification cooldowns list --json
```

Output example:
```
Event                Duration
provider.degraded    15m
budget.threshold     1h
```

#### `routerly notification cooldowns set`

```
routerly notification cooldowns set <event> <duration>
```

Set a cooldown for an event. Duration format: `15m`, `1h`, `30s`, `2d` (supports `s` / `m` / `h` / `d` suffixes).

```bash
routerly notification cooldowns set provider.degraded 15m
routerly notification cooldowns set budget.threshold 1h
routerly notification cooldowns set provider.error 30m
```

#### `routerly notification cooldowns delete`

```
routerly notification cooldowns delete <event>
```

Delete the cooldown for an event.

```bash
routerly notification cooldowns delete provider.degraded
```

---

## `routerly status`

```
routerly status [--json]
```

Check whether the active Routerly service is reachable. Prints URL, version, and uptime. Exit code `0` if the service is up, `1` otherwise.

