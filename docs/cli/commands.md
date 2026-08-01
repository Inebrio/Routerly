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
- **#** - priority (1 = checked first)
- **URL** - repository endpoint
- **File** - name of the last successfully resolved catalog file
- **Updated** - timestamp from the catalog (when the snapshot was created)
- **Last Check** - when Routerly last fetched from this repo
- **Status** - Active / Disabled / Error (with error details on hover or in JSON)

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

## `routerly modules`

Manage optional service modules. Disable unneeded modules to reduce memory and startup time. Core modules (`config`, `provider`, `catalog`, `reverse-proxy`, `routing`) cannot be disabled. Disabling a module requires a service restart to take effect.

### `routerly modules list`

```
routerly modules list [--json]
```

List all available modules with their enabled state, version, and dependencies.

**Table columns:**
- **ID** - module identifier
- **Version** - module semantic version
- **Enabled** - `yes` / `no`
- **Always-on** - `yes` / `no` (core modules cannot be disabled)
- **Depends on** - comma-separated list of module IDs this module requires; empty if no dependencies

**Example output:**
```
ID             Version   Enabled   Always-on   Depends on
guardrails     0.4.0     yes       no          -
pii            0.4.0     no        no          -
reverse-proxy  0.4.0     yes       yes         provider, routing
```

**JSON output** (`--json`):
```json
[
  {
    "id": "guardrails",
    "version": "0.4.0",
    "enabled": true,
    "alwaysOn": false,
    "dependsOn": []
  }
]
```

### `routerly modules enable`

```
routerly modules enable <id>
```

Enable a module (requires a service restart to take effect).

**Example:**
```bash
routerly modules enable guardrails
```

**Output on success:**
```
Enabled: guardrails
Restart the Routerly service for this to take effect (e.g. `docker restart <container>`, or stop and re-run the service process).
```

**Error cases:**
- Module is unknown: `Error: Unknown module "unknown-module"`
- Module has unmet dependencies: `Error: Cannot enable "guardrails": depends on disabled provider`

(Enabling an already-enabled or always-on module is a no-op, not an error.)

Exit code: `0` on success, `1` on error.

### `routerly modules disable`

```
routerly modules disable <id>
```

Disable a module (requires a service restart to take effect).

**Example:**
```bash
routerly modules disable guardrails
```

**Output on success:**
```
Disabled: guardrails
Restart the Routerly service for this to take effect (e.g. `docker restart <container>`, or stop and re-run the service process).
```

**Error cases:**
- Module is always-on (cannot be disabled): `Error: Module "reverse-proxy" is always-on and cannot be disabled`
- Module is unknown: `Error: Unknown module "unknown-module"`
- Module is required by other enabled modules: `Error: Cannot disable "provider": required by reverse-proxy, routing`

Exit code: `0` on success, `1` on error.

---

## `routerly connections`

Manage provider connections - credentials (API key, endpoint) shared by one or more model instances. Requires `connections:read` (list) / `connections:manage` (add, remove).

### `routerly connections list`

```
routerly connections list [--json]
```

List all configured provider connections.

**Table columns:**
- **ID** - connection identifier
- **Provider** - provider ID (e.g. `openai`, `anthropic`, `ollama`)
- **Label** - display label
- **Endpoint** - custom endpoint, or `-` if using the provider default
- **Enabled** - `yes` / `no`

Credentials are never printed, in the table or in `--json` output.

```bash
routerly connections list
routerly connections list --json
```

### `routerly connections add`

```
routerly connections add --provider-id <id> --label <label> [options]
```

| Option | Description |
|--------|-------------|
| `--provider-id <id>` | Provider ID (e.g. `openai`, `anthropic`, `ollama`) - required |
| `--label <label>` | Display label for this connection - required |
| `--endpoint <url>` | Custom API endpoint (uses provider default if omitted) |
| `--api-key <key>` | API key credential (stored plaintext; file permissions protect it) |
| `--credentials-json <json>` | Full credentials object as JSON (advanced; merges over `--api-key` on conflict) |
| `--enabled` / `--no-enabled` | Enable immediately (default: `true`) |

```bash
routerly connections add --provider-id openai --label "Main OpenAI" --api-key sk-...
routerly connections add --provider-id ollama --label "Local Ollama" --endpoint http://localhost:11434/v1
routerly connections add --provider-id anthropic --label "Anthropic" \
  --credentials-json '{"apiKey":"sk-ant-..."}'
```

### `routerly connections remove`

```
routerly connections remove <id>
```

Remove a provider connection by ID.

```bash
routerly connections remove c1
```

**Error cases:**
- Connection not found: `Error: Connection "<id>" not found.`

Exit code: `0` on success, `1` on error.

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
- **ID** - model identifier
- **Provider** - provider name
- **Endpoint** - base URL (custom endpoint or provider default)
- **Catalog** - tracking status: `(catalog)` (auto-synced), `(partial override)` (some fields locked), or empty (no catalog entry)
- **Connection ID** - ID of the `routerly connections` entry backing this model, or `-` if the model has no matching connection (not yet migrated, or the caller lacks `connections:read`)

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
  - **Auto-synced fields** - fields currently tracking the catalog
  - **Overridden fields** - locked fields with their catalog defaults shown
  - **Last synced** - timestamp of the most recent auto-sync

```bash
routerly model show gpt-5-mini
routerly model show gpt-5-mini --json
```

---

### `routerly model add`

```
routerly model add --id <id> --provider <provider> [options]
```

| Option | Description |
|--------|-------------|
| `--id <id>` | Model identifier (e.g. `gpt-5-mini`), required |
| `--provider <provider>` | Provider: `openai`, `anthropic`, `anthropic-oauth`, `gemini`, `ollama`, `custom`, `azure-openai`, `bedrock`, `vertex`, required |
| `--connection <id>` | Bind to an existing provider connection (see `routerly connections list`); omits inline credentials |
| `--endpoint <url>` | Custom API endpoint (uses provider default if omitted) |
| `--api-key <key>` | API key (stored plaintext; file permissions protect it) |
| `--input-price <usd>` | Cost per 1M input tokens in USD |
| `--output-price <usd>` | Cost per 1M output tokens in USD |
| `--daily-budget <usd>` / `--monthly-budget <usd>` | Global spend limit shorthand for `--limits-json` |
| `--limits-json <json>` | Limits array as JSON string |
| `--pricing-tiers-json <json>` | Pricing tiers array as JSON string |
| `--interactive` | Open interactive wizard for limits and pricing tiers |

Azure, AWS Bedrock, Google Vertex, and ChatGPT-web-session providers accept
additional provider-specific flags (`--azure-resource`, `--aws-region`,
`--vertex-project`, `--cf-clearance`, etc.); see `routerly model add --help`.

**`--connection` vs. inline credentials:**
- With `--connection <id>`: the model binds to that existing connection. No credential flags (`--api-key`, `--endpoint`, and the provider-specific credential flags) are sent; the connection already owns them. The connection's provider must match `--provider`.
- Without `--connection`: `--endpoint`/`--api-key` (and provider-specific flags) are sent inline, same as before the connections cutover. The service creates a dedicated, single-model connection with id `conn-for-<id>` from them and binds the model to it.

```bash
# Inline credentials (creates a dedicated conn-for-gpt-4o connection)
routerly model add --id gpt-4o --provider openai --api-key sk-...

# Bind to a preconfigured connection instead
routerly model add --id gpt-4o-mini --provider openai --connection conn-abc123
```

### `routerly model edit`

```
routerly model edit <id> [field options]
```

Same field options as `add`, except `--connection` (rebinding a model to a
different preconfigured connection is not available from the CLI; use the
dashboard model form, or the API's `PUT /api/models/:id` with a
`connectionId` body field). Only specified fields are updated.

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

Pricing is shown as the per-1,000-token rate. Models that carry a `local` flag in the catalog **or** that are zero-priced on both input and output are labelled `free/local` in green - this covers Ollama and other self-hosted models regardless of whether the catalog explicitly marks them as local.

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

### Routing - `routerly project routing`

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

### Models - `routerly project model`

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

### Tokens - `routerly project token`

#### `routerly project token list <project>`

List all API tokens for the project, including their names, IDs, creation date, and tags.

```bash
routerly project token list my-api
```

Output includes columns for:
- **Name** - token name
- **ID** - token identifier (first 8 characters)
- **Created** - when the token was created
- **Tags** - key-value metadata (comma-separated, or empty if no tags)

#### `routerly project token create <project>`

Create a new project API token. The token value is shown **once only**.

```bash
routerly project token create my-api
routerly project token create my-api --tag environment=prod --tag team=backend
routerly project token create my-api --scopes mcp,mcp:write
```

| Option | Description |
|--------|-------------|
| `--labels <list>` | Comma-separated free-text labels shown next to the token in the dashboard |
| `--scopes <list>` | Comma-separated access scopes (e.g. `mcp,mcp:write` for the [MCP server](../concepts/mcp.md)) |
| `--tag <key=value>` | Attach key-value metadata to the token (repeatable). Tags are included in every usage record created with this token. |

```bash
routerly project token create Test --scopes mcp,mcp:write --labels mcp-docs
```
```
✓ Token created for project "Test".

Token (save this - shown only once):
sk-rt-d551c6a3bc1c126f938839ec654806ebd0a86968824b81ccf81fb842ea82f54f
  ID:      b75b0cf0-5ba9-4c42-af93-e92059180cae
  Snippet: sk-rt-d551…
  Labels:  mcp-docs
  Scopes:  mcp, mcp:write
```

Optionally add spending limits inline:

| Option | Description |
|--------|-------------|
| `--limit <spec>` | Limit spec: `<model>:<metric>:<windowType>:<period>:<value>` (repeatable) |

Limit spec examples:
- `openai/gpt-5.2:cost:period:monthly:10` - $10/month cap
- `openai/gpt-5.2:calls:rolling:24:hours:500` - 500 calls per rolling 24 h

#### `routerly project token edit <project> <token-id>`

Update tags or spending limits on an existing token.

```bash
routerly project token edit my-api abc123 --tag environment=staging --tag team=qa
```

| Option | Description |
|--------|-------------|
| `--labels <list>` | Replace all labels with this comma-separated list. Omit to keep existing labels unchanged. |
| `--scopes <list>` | Replace all access scopes with this comma-separated list. Omit to keep existing scopes unchanged. |
| `--tag <key=value>` | Replace all tags with these key-value pairs (repeatable). Omit to keep existing tags unchanged. |
| `--add-limit <spec>` | Add a limit (repeatable) |
| `--remove-limit <spec>` | Remove a limit matching model+metric+window (repeatable) |

#### `routerly project token remove <project> <token-id>`

Revoke and delete an API token.

---

### Members - `routerly project member`

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

### Guardrails - `routerly project guardrails`

Manage the content guardrail configuration for a project. Guardrails evaluate each request and/or response against an ordered list of rules; each enabled rule is evaluated and triggers its configured actions independently.

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
  #   Type          Scope                Summary
  0   regex         request              2 pattern(s)
  1   semantic      both                 model: text-embedding-3-small (+1 fallback), 3 example(s)
  2   topic         request+inject       model: claude-haiku-4-5 (+1 fallback)
  3   moderation    response             model: claude-haiku-4-5
```

The Scope column shows the active flags:
- `request`: judge the user messages (hard block + log on trigger)
- `response`: judge the model response (hard block + log on trigger)
- `inject`: append the rule instruction to the request system prompt (soft steer, no block)
- Combinations like `request+response`, `request+inject`, etc. indicate multiple flags are enabled
- Regex/semantic rules show only `request`, `response`, or `both` (no inject)

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

2. **Scope flags** (topic/moderation only):
   - Three independent checkboxes: Request (judge the user message), Inject (append to system prompt), Response (judge the model response)
   - At least one must be enabled
   - Request and Response toggle hard blocks + logging; Inject is soft steering only
   - For regex/semantic: choice of request, response, or both (no inject option)

3. **Judge configuration** (topic/moderation only, when Request and/or Response is checked):
   - Judge model ID: select from available models (filtered to exclude embedding-only models)
   - Optional fallback judge models: comma-separated list of model IDs to try if the primary is unavailable or errors. If the primary model returns a budget-exceeded error, fallbacks are not tried (fail-closed).

4. **Threshold**: harm score for moderation (default 0.5, triggers when score > threshold), or topic score for topic (default 0.5, triggers when score < threshold for off-topic).

5. **Type-specific fields**: prompts depend on the rule type selected.
   - **Regex**: regex patterns (one per line, case-insensitive)
   - **Semantic**: embedding model, fallback models, example phrases to block, similarity threshold
   - **Topic**: allowed-topics description
   - **Moderation**: custom instructions (required; used for injection or passed to the judge)

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

Manage PII scrubbing policies for a project. PII detection and scrubbing configuration uses policies, each with its own entity set, patterns, direction, and streaming buffer.

#### `routerly project pii list <project>`

List all PII policies for a project.

```bash
routerly project pii list my-api
routerly project pii list my-api --json
```

Output example:

```
PII Policies - my-api
  #   Enabled   Target     Entities
  0   yes       both       EMAIL, PHONE, CREDIT_CARD, SSN, IBAN
  1   yes       request    EMAIL, PHONE
```

Policies are identified by their 0-based index (`#` column).

#### `routerly project pii add <project>`

Add a new PII policy.

```bash
routerly project pii add my-api
```

Launches an interactive wizard. Steps:

1. **Target**: `request`, `response`, or `both` (which side(s) to scrub)
2. **Entities**: comma-separated list of entity types to detect (EMAIL, PHONE, CREDIT_CARD, SSN, IBAN). Leave empty to include none.
3. **Custom patterns**: comma-separated regex patterns to scrub in addition to entity detection. Leave empty for none.
4. **Output buffer size**: (response scrubbing only) suffix buffer size in characters (default 30, valid range: 10 to 500). Used to catch patterns spanning chunk boundaries when streaming. Prompted only when target includes response.

#### `routerly project pii remove <project> <index>`

Remove a PII policy by its 0-based index (from `pii list`).

```bash
routerly project pii remove my-api 0   # Remove the first policy
routerly project pii remove my-api 1   # Remove the second policy
```

The index is validated against the current policy list.

---

## `routerly integrations`

Manage metric export integrations for external observability platforms.

### `routerly integrations list`

```
routerly integrations list [--json]
```

Lists all configured integrations in a table with ID (truncated), Type, Enabled status, and Name/Endpoint.

**Table columns:**
- **ID** - integration UUID (first 8 chars)
- **Type** - provider type (prometheus, otel, datadog, grafana, influxdb, webhook)
- **Enabled** - yes/no status
- **Name/Endpoint** - friendly name or primary identifier

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

## `routerly resilience`

View and manage circuit-breaker resilience state (per-provider, per-connection, and per-model fault tracking used to route around a degraded upstream).

### `routerly resilience status`

```
routerly resilience status [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON |

**Table columns:**
- **Level** - `provider` / `connection` / `model`
- **ID** - the provider, connection, or model ID this entry tracks
- **State** - `closed` (green, healthy) / `open` (red, tripped) / `half-open` (yellow, probing recovery)
- **Last Fault** - most recent failure category (e.g. `rate-limit`, `timeout`, `server`), or `-`
- **Failures** - failure count contributing to the current state
- **Opened At** - when the breaker left `closed`, or `-`
- **Cooldown Until** - connection cooldown / rate-limit expiry, or `-`
- **Lockout Until** - model-instance lockout expiry, or `-`

If no entries have been recorded yet, prints `No resilience entries recorded yet.` instead of an empty table.

Examples:

```
routerly resilience status
routerly resilience status --json
```

**JSON output** (`--json`) is the raw `ResilienceSnapshot`:
```json
{
  "entries": [
    {
      "key": { "level": "provider", "id": "openai" },
      "state": "open",
      "lastFault": "rate-limit",
      "failureCount": 5,
      "openedAt": 1700000000000,
      "cooldownUntil": 1700000060000
    }
  ],
  "generatedAt": 1700000100000
}
```

Requires `resilience:read` permission.

### `routerly resilience reset`

```
routerly resilience reset [options]
```

| Option | Description |
|--------|-------------|
| `--level <level>` | Resilience level: `provider`, `connection`, or `model` (requires `--id`) |
| `--id <id>` | ID within the given level (requires `--level`) |

Resets circuit-breaker state back to `closed`. Omit both flags to reset every tracked entry; pass both together to reset a single key. Passing only one of `--level`/`--id` is rejected with an error (both-or-neither).

Examples:

```
routerly resilience reset
routerly resilience reset --level provider --id openai
routerly resilience reset --level model --id gpt-4
```

**Output on success:**
```
✓ Reset resilience state for provider "openai".
```
(or `✓ Reset all resilience state.` when both flags are omitted)

**Error cases:**
- Only one of `--level`/`--id` provided: `API error 400: Invalid resilience reset body`

Requires `resilience:manage` permission.

Exit code: `0` on success, `1` on error (both subcommands).

---

## `routerly profiles`

Manage profiles: reusable configuration bundles a project can adopt in place of its own inline setup. A profile has one `kind`:

| Kind | What it bundles |
|------|-----------------|
| `routing` | policy list, selector, fallback strategy |
| `optimizer` | the ordered optimizer pipeline |
| `security` | guardrail rules and PII policies |

A project binds at most one profile per kind, and the three are independent. See [Dashboard: Profiles](../dashboard/profiles.md) for the equivalent UI.

### `routerly profiles list`

```
routerly profiles list [--kind <kind>] [--json]
```

List all profiles (built-in presets and user profiles), optionally filtered by kind.

| Option | Description |
|--------|-------------|
| `--kind <kind>` | Filter by `routing`, `optimizer` or `security` |
| `--json` | Output the profile list as raw JSON |

**Table columns:**
- **ID** - profile identifier
- **Kind** - `routing` / `optimizer` / `security`
- **Label** - display label
- **Builtin** - `yes` / `no`
- **Version** - profile version, bumped on each update
- **Summary** - one-line, kind-specific description of the configuration

```bash
routerly profiles list
routerly profiles list --kind optimizer
routerly profiles list --json
```

**Error cases:**
- Unknown kind: `Unknown kind "<value>". Expected one of: routing, optimizer, security.`

Requires `profiles:read` permission.

### `routerly profiles show`

```
routerly profiles show <id> [--json]
```

Show full details of one profile. There is no single-item GET endpoint for profiles; `show` fetches the full list and filters client-side by ID.

Prints the common fields (`id`, `kind`, `label`, `builtin`, `version`, and `baseId` if the profile was cloned), followed by a kind-specific block: policies for `routing`, the pipeline in execution order for `optimizer`, guardrail rules and PII policies for `security`.

```bash
routerly profiles show auto
routerly profiles show security-strict --json
```

**Error cases:**
- Unknown ID: `Profile "<id>" not found. Run \`routerly profiles list\` to see available profiles.`

Requires `profiles:read` permission.

### `routerly profiles create`

```
routerly profiles create --kind <kind> --label <label> [--json]
```

Create an empty profile of the given kind. The CLI has no editor for profile bodies: fill the new profile in from the dashboard, or use `clone` to start from a preset.

| Option | Description |
|--------|-------------|
| `--kind <kind>` | `routing`, `optimizer` or `security` - required |
| `--label <label>` | Label for the new profile - required |
| `--json` | Output the created profile as raw JSON |

```bash
routerly profiles create --kind routing --label "My Routing"
routerly profiles create --kind security --label "My Guardrails" --json
```

**Output on success:**
```
✓ Created routing profile "My Routing" -> 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
```

Requires `profiles:manage` permission.

### `routerly profiles clone`

```
routerly profiles clone <baseId> --label <label> [--json]
```

Clone a built-in profile of any kind into a new, editable user profile. The clone keeps the base profile's kind and configuration.

| Option | Description |
|--------|-------------|
| `--label <label>` | Label for the new profile - required |
| `--json` | Output the created profile as raw JSON |

```bash
routerly profiles clone auto --label "My Routing"
routerly profiles clone optimizer-aggressive --label "My Optimizers"
```

**Output on success:**
```
✓ Cloned routing profile "auto" -> 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
```

Requires `profiles:manage` permission.

### `routerly profiles delete`

```
routerly profiles delete <id>
```

Delete a user profile. Built-in profiles cannot be deleted, and a profile still assigned to a project is refused.

```bash
routerly profiles delete 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
```

**Output on success:**
```
✓ Profile "8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31" deleted
```

**Error cases:**
- Profile assigned to a project: `Cannot delete "<id>": it is still assigned to a project.`

Requires `profiles:manage` permission.

### `routerly profiles set`

```
routerly profiles set <project> <kind> [profileId] [--none] [--json]
```

Assign or clear the profile of one kind for a project. Provide `profileId` to assign it, or `--none` to clear the assignment and fall back to the project's own inline configuration for that kind. The other two kinds are left untouched.

| Option | Description |
|--------|-------------|
| `--none` | Clear the assignment for this kind |
| `--json` | Output the updated (sanitized) project as raw JSON |

```bash
routerly profiles set my-api routing auto
routerly profiles set my-api optimizer optimizer-aggressive
routerly profiles set my-api security --none
```

**Output on success:**
```
✓ routing profile set to "auto" on project "my-api"
```
(or `✓ security profile cleared on project "my-api"` with `--none`)

**Error cases:**
- Neither `profileId` nor `--none` given: `Error: provide a profileId or --none.`
- Unknown kind: `Unknown kind "<value>". Expected one of: routing, optimizer, security.`
- Project not found: `Project "<name>" not found. Run \`routerly project list\` to see available projects.`

Requires `project:write` permission.

### `routerly profiles get`

```
routerly profiles get <project> [--json]
```

Show which profile each kind is bound to for a project. A kind with no profile assigned prints `custom`, meaning the project uses its own inline configuration. `--json` prints an object keyed by kind, with `null` for unassigned kinds.

```bash
routerly profiles get my-api
routerly profiles get my-api --json
```

No extra permission beyond dashboard authentication: it reads the project list.

Exit code: `0` on success, `1` on error (all subcommands).

---

## `routerly optimizers`

Manage the prompt/context optimizer catalog and a project's per-optimizer
pipeline config. See [Concepts: Optimizers](../concepts/optimizers.md) for
what each optimizer does and its class.

### `routerly optimizers list`

```
routerly optimizers list [--json]
```

List the installed optimizer catalog (all 7 optimizer ids ship built-in;
`installed` reflects whether the module registered itself, which is always
`true` unless a module was intentionally removed from the build).

**Table columns:**
- **ID** - optimizer id
- **Klass** - `lossless` / `recoverable` / `lossy`
- **Installed** - `yes` / `no`

```bash
routerly optimizers list
```
```
┌───────────────┬─────────────┬───────────┐
│ ID            │ Klass       │ Installed │
├───────────────┼─────────────┼───────────┤
│ session-dedup │ lossless    │ yes       │
├───────────────┼─────────────┼───────────┤
│ ccr           │ recoverable │ yes       │
├───────────────┼─────────────┼───────────┤
│ rtk           │ recoverable │ yes       │
├───────────────┼─────────────┼───────────┤
│ headroom      │ lossless    │ yes       │
├───────────────┼─────────────┼───────────┤
│ relevance     │ lossy       │ yes       │
├───────────────┼─────────────┼───────────┤
│ caveman       │ lossy       │ yes       │
├───────────────┼─────────────┼───────────┤
│ llmlingua-2   │ lossy       │ yes       │
└───────────────┴─────────────┴───────────┘
```

```bash
routerly optimizers list --json
```
```json
[
  { "id": "session-dedup", "klass": "lossless", "installed": true },
  { "id": "ccr", "klass": "recoverable", "installed": true },
  { "id": "rtk", "klass": "recoverable", "installed": true },
  { "id": "headroom", "klass": "lossless", "installed": true },
  { "id": "relevance", "klass": "lossy", "installed": true },
  { "id": "caveman", "klass": "lossy", "installed": true },
  { "id": "llmlingua-2", "klass": "lossy", "installed": true }
]
```

Requires `optimizers:read` permission.

### `routerly optimizers config`

```
routerly optimizers config <project> [--enable id] [--disable id] [--threshold id=val] [--order ids] [--json]
```

Read-modify-write a project's `optimizers.steps`. Run with no flags to print
the current pipeline unchanged.

| Option | Description |
|--------|-------------|
| `--enable <id>` | Enable an optimizer step (repeatable) |
| `--disable <id>` | Disable an optimizer step (repeatable) |
| `--threshold <id=val>` | Set an optimizer step's threshold, range depends on the optimizer id (repeatable), see [Threshold Range](../concepts/optimizers.md#threshold-range) |
| `--order <ids>` | Comma-separated optimizer ids controlling step order |
| `--json` | Output the updated (sanitized) project as raw JSON |

`--enable`/`--disable`/`--threshold` create the step if it is not already
configured (new steps default to `enabled: false` unless `--enable` is also
given for that id). `--order` stable-sorts existing steps to the given id
order; ids not listed keep their relative order at the end.

```bash
routerly optimizers config Test --order session-dedup,caveman,rtk,relevance,ccr
```
```
✓ Updated optimizer pipeline on project "Test"
┌───┬───────────────┬─────────┬───────────┐
│ # │ ID            │ Enabled │ Threshold │
├───┼───────────────┼─────────┼───────────┤
│ 1 │ session-dedup │ yes     │ -         │
├───┼───────────────┼─────────┼───────────┤
│ 2 │ caveman       │ yes     │ -         │
├───┼───────────────┼─────────┼───────────┤
│ 3 │ rtk           │ yes     │ -         │
├───┼───────────────┼─────────┼───────────┤
│ 4 │ relevance     │ yes     │ 0.3       │
├───┼───────────────┼─────────┼───────────┤
│ 5 │ ccr           │ no      │ 8         │
└───┴───────────────┴─────────┴───────────┘
```

**Error cases:**
```bash
routerly optimizers config Test --threshold badformat
```
```
Error: --threshold expects id=value, got "badformat".
```
```bash
routerly optimizers config Test --threshold relevance=1.5
```
```
Error: Invalid optimizers config
```
`relevance` and `llmlingua-2` thresholds are capped at `1` (a
ratio); `ccr` and `headroom` accept any positive number (a turn count and a
token budget respectively). See [Concepts: Optimizers, Threshold
Range](../concepts/optimizers.md#threshold-range).
```bash
routerly optimizers config nonexistent-project-xyz --enable rtk
```
```
Project "nonexistent-project-xyz" not found. Run `routerly project list` to see available projects.
```

Requires `optimizers:manage` permission.

### `routerly optimizers preview`

```
routerly optimizers preview <project> --message <text> [--message <text> ...] [--json]
```

Dry-run the project's currently configured optimizer pipeline against a
sample message list. No upstream call is made and the project's config is
not modified.

| Option | Description |
|--------|-------------|
| `--message <text>` | Sample user message (repeatable, required, at least one) |
| `--json` | Output the raw preview result as JSON |

```bash
routerly optimizers preview Test \
  --message "The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. Please remember: the quick brown fox jumps over the lazy dog." \
  --message "What is the capital of France?"
```
```
Tokens before: 46
Tokens after:  32
Saved:         14

┌───────────────┬────────┬───────┐
│ ID            │ Before │ After │
├───────────────┼────────┼───────┤
│ ccr           │ 46     │ 46    │
├───────────────┼────────┼───────┤
│ session-dedup │ 46     │ 46    │
├───────────────┼────────┼───────┤
│ caveman       │ 46     │ 32    │
├───────────────┼────────┼───────┤
│ rtk           │ 32     │ 32    │
├───────────────┼────────┼───────┤
│ relevance     │ 32     │ 32    │
└───────────────┴────────┴───────┘
```

The per-step table lists every configured step in pipeline order, including
disabled ones (`before === after` for a disabled or no-op step). Token
counts are the `chars / 4` approximation used by the live pipeline, not a
provider-exact tokenizer.

Requires `optimizers:read` permission.

Exit code: `0` on success, `1` on error (all subcommands).

---

## `routerly clients`

Configure local AI coding clients (Claude Code, Codex, OpenCode, Continue,
Cline) to use Routerly. Unlike the rest of the CLI, these commands write
files on **this machine** (your workstation running the CLI), not on the
Routerly server. They edit the config file of a client tool installed
locally. See [Integrations: Auto-configure](../integrations/overview.md#auto-configure)
for one manual reference page per client.

These commands require a logged-in session (`routerly auth login`). No
specific permission is required for `list`, `inspect`, `doctor`, `undo`,
`launch`, or `configure --token <token>` (reusing an existing token skips
minting). Minting a new token via `configure` (the default, when `--token`
is omitted) requires `project:write` permission on the target project.

### `routerly clients list`

```
routerly clients list [--json]
```

List every supported client with its support level.

**Table columns:**
- **ID**: client identifier, used by `inspect`/`configure`/`launch`
- **Label**: display name
- **Support**: `auto-configurable` (green, `configure` writes the file for
  you), `launchable` (green), `documented` (gray, manual-only, no file this
  CLI can safely write), `partial`/`stale` (yellow)

```bash
routerly clients list
```
```
┌─────────────┬─────────────┬───────────────────┐
│ ID          │ Label       │ Support           │
├─────────────┼─────────────┼───────────────────┤
│ claude-code │ Claude Code │ auto-configurable │
├─────────────┼─────────────┼───────────────────┤
│ codex       │ Codex       │ auto-configurable │
├─────────────┼─────────────┼───────────────────┤
│ opencode    │ OpenCode    │ auto-configurable │
├─────────────┼─────────────┼───────────────────┤
│ continue    │ Continue    │ auto-configurable │
├─────────────┼─────────────┼───────────────────┤
│ cline       │ Cline       │ documented        │
└─────────────┴─────────────┴───────────────────┘
```

### `routerly clients inspect`

```
routerly clients inspect <id> [--json]
```

Detect whether a client is installed on this machine and whether its config
file already points at Routerly.

```bash
routerly clients inspect claude-code
```
```
Claude Code
  Support:    auto-configurable
  Installed:  yes (2.1.209 (Claude Code))
  Config:     /Users/you/.claude/settings.json
  Configured: no
```

If the config file is already pointed at a different Routerly instance than
the CLI's currently active account, `Base URL:` is printed with a `(stale)`
suffix.

**Error cases:**
```bash
routerly clients inspect not-a-real-client
```
```
Unknown client "not-a-real-client". Run `routerly clients list` to see supported clients.
```
Exit code `1`, printed to stderr, before any file I/O.

### `routerly clients configure`

```
routerly clients configure <id> [--project <id>] [--token <token>] [--yes] [--json]
```

Write Routerly connection settings into a client's own config file. Shows a
before/after plan, then applies it.

| Option | Description |
|--------|-------------|
| `--project <id>` | Project name or ID to mint/use a token for (prompts with a picker if omitted) |
| `--token <token>` | Use this token instead of minting a new one, skips the consent prompt |
| `--yes` | Skip the consent prompt without supplying `--token` (a new token is still minted) |
| `--json` | Output `{ plan, applied, validated }` as JSON instead of the human-readable plan |

**Mint vs. `--token`:** by default `configure` mints a brand-new project
token via `POST /api/projects/:id/tokens` and asks for confirmation first
(`Mint a new Routerly token for project "…" to configure …?`). Pass an
existing token with `--token` to reuse it instead. No new token is created
and no prompt is shown. `--yes` skips the confirmation prompt but still
mints a new token; use `--token` if you don't want a new token minted at all.

```bash
routerly clients configure opencode --project Test --token sk-rt-YOUR_PROJECT_TOKEN
```
```
Plan for OpenCode (/Users/you/.config/opencode/opencode.json):
--- before ---
(file does not exist)
--- after ----
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "routerly": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Routerly",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "sk-rt-YOUR_PROJECT_TOKEN"
      },
      "models": {
        "routerly/ada": {
          "name": "Routerly (auto-routed)"
        }
      }
    }
  }
}

✓ OpenCode configured (/Users/you/.config/opencode/opencode.json).
  Backup ID: 3c2d1970-e4b6-4902-a798-84cdd86cb92d (undo with `routerly clients undo 3c2d1970-e4b6-4902-a798-84cdd86cb92d`)
✓ Routerly service reachable at http://localhost:3000
```

**Backup guarantee:** before writing, `configure` always backs up the
existing file (or records that it did not exist) under
`~/.routerly/cli/client-backups/<backupId>/`: `manifest.json` (backup ID,
client ID, original path, SHA-256 checksum of the original content,
whether the file existed before, mode `0o600`) plus the original file's
bytes (mode `0o600`), in a directory (mode `0o700`), fsync'd to disk before
the write proceeds. `ROUTERLY_HOME` defaults to `~/.routerly` (overridable
via the `ROUTERLY_HOME` env var). Every successful `configure` prints its
`Backup ID`. Save it if you want to `undo` later.

**Cline** (`documented`, not auto-configurable) always errors instead of
writing a file:
```bash
routerly clients configure cline --project Test --yes
```
```
Error: Cline is not auto-configurable: it is configured through the extension's settings UI (gear icon panel: Base URL / API Key / Model ID), not a standalone file this CLI can safely edit. See docs: integrations/clients/cline
```
Exit code `1`. See [Integrations: Cline](../integrations/clients/cline.md)
for the manual steps.

### `routerly clients doctor`

```
routerly clients doctor
```

Checks Routerly service reachability (`GET /api/system/info`) and whether
the client-configurator module is enabled on the server (`GET
/api/clients`).

```bash
routerly clients doctor
```
```
✓ Routerly service reachable (version 0.3.0).
✓ Client configurator module enabled (5 client(s) registered).
```

If the module is disabled on the server, this is reported as informational,
not a failure (exit code stays `0`):
```
  Client configurator module is disabled on the service.
```
Any other error (service unreachable, network failure) on either check sets
exit code `1`.

### `routerly clients undo`

```
routerly clients undo <backupId>
```

Restore a client config file to its exact state before a `configure` run,
using the backup ID printed by that run. If the file did not exist before
`configure` created it, `undo` deletes it. The restore is checksum-verified
against the backup manifest before it is written back.

```bash
routerly clients undo 3c2d1970-e4b6-4902-a798-84cdd86cb92d
```
```
✓ Restored /Users/you/.config/opencode/opencode.json (client: opencode).
```

**Error cases:**
```bash
routerly clients undo bogus-id-1234
```
```
Backup "bogus-id-1234" not found. Backup IDs are printed by `routerly clients configure`.
```
Exit code `1`. An unknown backup ID is rejected before any file I/O: the
backup manifest is looked up first.

### `routerly clients launch`

```
routerly clients launch <id>
```

Launch an installed client binary, for clients whose integration supports
it (spawns the process with inherited stdio).

```bash
routerly clients launch cline
```
```
Cline does not support launching from Routerly.
```
Exit code `1`. Cline has no standalone CLI binary. Clients without a
`launch` step behave the same way; the error names the client.

Exit code: `0` on success, `1` on error (all subcommands).

---

## `routerly mcp`

Inspect and exercise the [MCP server](../concepts/mcp.md): the tools
Routerly exposes to MCP clients (Claude Code, Claude Desktop, and similar)
over `/mcp`. The project token used by `test` and `serve` must carry the
`mcp` scope (`mcp:write` for the 2 write tools); see
[`routerly project token create`](#tokens---routerly-project-token) `--scopes`.

### `routerly mcp tools`

```
routerly mcp tools [--json]
```

List the MCP tools currently exposed by the server (management surface,
`GET /api/mcp/tools`, requires `mcp:read`). A tool is only listed when its
backing module is bootstrapped on this instance.

```bash
routerly mcp tools
```
```
┌──────────────────────┬───────┬──────────────────┬─────────┐
│ Name                 │ Scope │ Module           │ Enabled │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ list_models          │ read  │ catalog.registry │ yes     │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ get_model            │ read  │ catalog.registry │ yes     │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ route_preview        │ read  │ routing.router   │ yes     │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ get_usage_summary    │ read  │ usage.tracker    │ yes     │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ get_budget_status    │ read  │ cost.budget      │ yes     │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ list_projects        │ read  │ config.store     │ yes     │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ create_project_token │ write │ config.store     │ yes     │
├──────────────────────┼───────┼──────────────────┼─────────┤
│ toggle_model         │ write │ config.store     │ yes     │
└──────────────────────┴───────┴──────────────────┴─────────┘
```
(`get_metrics_snapshot` is a ninth built-in tool, omitted here because the
observability module was not bootstrapped on this instance: module-gated
tools disappear from the list entirely rather than showing `enabled: no`.)

Requires `mcp:read` permission.

### `routerly mcp test`

```
routerly mcp test <tool> [--input <json>] [--project <id>] [--token <token>] [--json]
```

Invoke one tool over the live `/mcp` transport with a real project token,
useful to verify a tool works before wiring an MCP client to it.

| Option | Description |
|--------|-------------|
| `--input <json>` | Tool arguments as a JSON object (default `{}`) |
| `--project <id>` | Project to mint a token for (defaults to the only project; required when more than one project exists) |
| `--token <token>` | Use an explicit project token instead of minting one |
| `--json` | Output the raw tool result as JSON |

```bash
routerly mcp test get_model --input '{"id":"openai/gpt-5.2"}' --project Test --token sk-rt-...
```
```
{
  "id": "openai/gpt-5.2",
  "provider": "openai",
  "contextWindow": 400000
}
```

**Error cases:**
- `--input` is not valid JSON: `Error: --input must be valid JSON.` (checked before any network call)
- Token lacks the `mcp` scope: `Error: Project token lacks the 'mcp' scope required to use the MCP endpoint.`
- Tool call fails (e.g. unknown id): the tool's `isError` message, printed to stderr

### `routerly mcp serve`

```
routerly mcp serve [--project <id>] [--token <token>]
```

Run the MCP server over stdio for local clients (Claude Desktop and
similar). Mints (or accepts) a project token, then spawns the Routerly
service binary with `ROUTERLY_MCP_STDIO=1` and `ROUTERLY_MCP_TOKEN=<token>`
set. See [Reference: Environment Variables](../reference/environment-variables.md#mcp-server-variables).
This is the command a client's MCP config points its `command`/`args` at.

| Option | Description |
|--------|-------------|
| `--project <id>` | Project to mint a token for (defaults to the only project) |
| `--token <token>` | Use an explicit project token instead of minting one |

```bash
routerly mcp serve --project my-api
```
```
Starting MCP stdio server for project "my-api"...
```
Diagnostics print to stderr only; stdout is reserved for the MCP protocol
stream. The process stays attached until the client disconnects; the CLI
propagates the child process's exit code.

Exit code: `0` on success, `1` on error (all subcommands).

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
Breakdown - completion: 142 calls / $0.001200  |  routing: 8 calls / $0.000011  |  guardrail: 12 calls / $0.000023  |  blocked: 3 calls
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

With no argument, prints the current channel. With an argument, updates the channel immediately - the running service is notified without a restart.

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
Admin role required. Not available inside Docker containers - pull the new image and recreate the container instead. Not available on Windows - run the installer script manually.
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

