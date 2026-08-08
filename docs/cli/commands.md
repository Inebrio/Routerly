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
- **Provider** - provider ID (e.g. `openai`, `anthropic`, `ollama`); a `custom` connection also shows its upstream provider name, e.g. `custom (deepseek)`
- **Label** - unique name of the connection
- **Endpoint** - custom endpoint, or `-` if using the provider default
- **Enabled** - `yes` / `no`

Credentials are never printed, in the table or in `--json` output.

```bash
routerly connections list
routerly connections list --json
```

### `routerly connections add`

```
routerly connections add --provider-id <id> [options]
```

| Option | Description |
|--------|-------------|
| `--provider-id <id>` | Provider ID (e.g. `openai`, `anthropic`, `ollama`, `custom`) - required |
| `--label <label>` | Unique name for this connection. Omit it and the server names it after the provider: `openai`, then `openai-2`, `openai-3`, ... A `custom` connection is named after `--provider-name` instead. A name already used by another connection is rejected with `API error 400: Label "<name>" is already used by another connection` |
| `--provider-name <name>` | Upstream provider behind a `custom` connection (e.g. `deepseek`); models on this connection use it as their ID prefix |
| `--endpoint <url>` | Custom API endpoint (uses provider default if omitted) |
| `--api-key <key>` | API key credential (stored plaintext; file permissions protect it) |
| `--credentials-json <json>` | Full credentials object as JSON (advanced; merges over `--api-key` on conflict) |
| `--enabled` / `--no-enabled` | Enable immediately (default: `true`) |

```bash
routerly connections add --provider-id openai --api-key sk-...
routerly connections add --provider-id openai --label "Main OpenAI" --api-key sk-...
routerly connections add --provider-id ollama --label "Local Ollama" --endpoint http://localhost:11434/v1
routerly connections add --provider-id anthropic --label "Anthropic" \
  --credentials-json '{"apiKey":"sk-ant-..."}'
routerly connections add --provider-id custom --provider-name deepseek --label "DeepSeek" \
  --endpoint https://api.deepseek.com/v1 --api-key sk-...
```

An OpenAI-compatible service that has no dedicated provider ID is registered with
`--provider-id custom`. `--provider-name` names the service behind the endpoint: a model
created on that connection is addressed as `<provider-name>/<model>`, e.g.
`deepseek/deepseek-r1`.

### `routerly connections edit`

```
routerly connections edit <id> [options]
```

Update a connection; only the fields passed are changed. Accepts the same
`--label`, `--provider-name`, `--endpoint`, credential and `--enabled` / `--no-enabled`
options as `add`. Credential flags replace only the fields passed; the rest of the stored
credentials are preserved.

```bash
routerly connections edit c1 --label "Renamed"   # blank name regenerates it from the provider
routerly connections edit c1 --provider-name deepseek
routerly connections edit c1 --api-key sk-new
routerly connections edit c1 --no-enabled
```

### `routerly connections show`

```
routerly connections show <id> [--json]
```

Show one connection. Credentials are never printed. `Provider name` appears only when the
connection carries an upstream provider name.

```bash
routerly connections show c1
routerly connections show c1 --json
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
`--vertex-router`, `--cf-clearance`, etc.); see `routerly model add --help`.

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

## `routerly router`

Router commands are organised into sub-groups. The first argument is always a **router name or ID**.

### `routerly router list`

```
routerly router list [--json]
```

### `routerly router create`

```
routerly router create [options]
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Router display name (required) |
| `--timeout <ms>` | Time-to-first-token timeout per model attempt, in ms (default `2000`, `0` disables it) |
| `--routing-model <id>` | Model ID used for routing decisions |

### `routerly router edit`

```
routerly router edit <router> [options]
```

| Option | Description |
|--------|-------------|
| `--name <name>` | New display name |
| `--timeout <ms>` | New time-to-first-token timeout per model attempt, in ms (`0` disables it) |
| `--trace-content` | Record prompts and answers in the router's traces |
| `--no-trace-content` | Record metadata only: no prompts, no answers (default) |

Traces always carry metadata (models, policies, guardrail outcomes, tokens,
timings). Prompts and answers are recorded only with `--trace-content`, and the
setting applies to every surface that reads a trace: the dashboard, the
Playground, and any integration exporting traces. A flag that is not passed
leaves the stored value alone. `routerly router show` prints the current state
as `Traces: metadata only` or `Traces: metadata + content`.

```bash
routerly router edit my-api --trace-content
routerly router edit my-api --no-trace-content
```

### `routerly router remove`

```
routerly router remove <router>
```

---

### Routing - `routerly router routing`

#### `routerly router routing show <router>`

Display the routing configuration (auto-routing flag, routing model, fallback models, and policy stack).

#### `routerly router routing update <router>`

```
routerly router routing update <router> [options]
```

| Option | Description |
|--------|-------------|
| `--routing-model <id>` | Model ID used for LLM-based routing decisions |
| `--fallback-models <ids>` | Comma-separated fallback routing model IDs |
| `--auto-routing` / `--no-auto-routing` | Enable or disable auto-routing |

#### `routerly router routing policy list <router>`

List all routing policies with their priority order, enabled status, and configuration.

#### `routerly router routing policy enable <router> <type>`

Enable a policy type (adds it to the stack if not present). Optionally pass `--config <json>` for policy-specific settings.

Available types: `health`, `context`, `capability`, `budget-remaining`, `rate-limit`, `llm`, `performance`, `fairness`, `cheapest`

```bash
routerly router routing policy enable my-api health
routerly router routing policy enable my-api llm --config '{"memoryCount":3}'
```

#### `routerly router routing policy disable <router> <type>`

Disable a policy without removing it from the stack.

#### `routerly router routing policy reorder <router> <types>`

Reorder the policy stack. Provide a comma-separated list of types in the desired evaluation order; any unlisted policies are appended at the end.

```bash
routerly router routing policy reorder my-api health,context,budget-remaining,llm,cheapest
```

---

### Models - `routerly router model`

A passthrough-kind router's model list always contains one **pass-through
entry** (`__passthrough__`) alongside zero or more real target models, in one
ordered array — it forwards the client's own credential unchanged and is
created automatically, never by hand. `model list` and `model reorder` render
it as `(pass-through) __passthrough__`, distinct from a real model ID.
`model add`, `model remove`, and `model set-prompt` all reject an attempt to
touch it (named stderr error, exit 1) — it has no prompt and can never be
removed. Reorder it like any other entry with `model reorder`.

#### `routerly router model list <router>`

List target models configured in the router, with their prompt hints. On a
passthrough router, the pass-through entry is shown as `(pass-through)
__passthrough__`.

#### `routerly router model add <router> <model-id>`

```bash
routerly router model add my-api openai/gpt-5.2
routerly router model add my-api anthropic/claude-opus-4-6 --prompt "Use for complex reasoning"
```

| Option | Description |
|--------|-------------|
| `--prompt <text>` | System prompt hint used when this model is selected |

Rejects `__passthrough__` (exit 1) — the pass-through entry cannot be added
manually.

#### `routerly router model remove <router> <model-id>`

Remove a target model from the router. Rejects `__passthrough__` (exit 1) —
the pass-through entry is always present on a passthrough-kind router and
cannot be removed.

#### `routerly router model set-prompt <router> <model-id>`

Update (or clear) the system prompt hint for a model.

```bash
routerly router model set-prompt my-api openai/gpt-5.2 --prompt "Fast tasks only"
routerly router model set-prompt my-api openai/gpt-5.2 --prompt ""  # clear
```

Rejects `__passthrough__` (exit 1) — it forwards the request unmodified, so
there is no prompt to set.

#### `routerly router model reorder <router> <model-ids>`

Reorder target models: a comma-separated list of model IDs in the desired
order. Any model not mentioned is appended at the end, in its current
relative order. `__passthrough__` can appear anywhere in the list, including
first or last.

```bash
routerly router model reorder my-api openai/gpt-5.2,anthropic/claude-opus-4-6

# Move the pass-through entry to the front of a passthrough router's model list
routerly router model reorder my-api __passthrough__,openai/gpt-5.2
```

---

### Tokens - `routerly router token`

#### `routerly router token list <router>`

List all API tokens for the router, including their names, IDs, creation date, and tags.

```bash
routerly router token list my-api
```

Output includes columns for:
- **Name** - token name
- **ID** - token identifier (first 8 characters)
- **Created** - when the token was created
- **Tags** - key-value metadata (comma-separated, or empty if no tags)

#### `routerly router token create <router>`

Create a new router API token. The token value is shown **once only**.

```bash
routerly router token create my-api
routerly router token create my-api --tag environment=prod --tag team=backend
routerly router token create my-api --scopes batch,internal
```

| Option | Description |
|--------|-------------|
| `--labels <list>` | Comma-separated free-text labels shown next to the token in the dashboard |
| `--scopes <list>` | Comma-separated free-form scopes (e.g. `batch,internal`), stored with the token for your own bookkeeping |
| `--tag <key=value>` | Attach key-value metadata to the token (repeatable). Tags are included in every usage record created with this token. |

```bash
routerly router token create Test --scopes batch,internal --labels nightly
```
```
✓ Token created for router "Test".

Token (save this - shown only once):
sk-rt-d551c6a3bc1c126f938839ec654806ebd0a86968824b81ccf81fb842ea82f54f
  ID:      b75b0cf0-5ba9-4c42-af93-e92059180cae
  Snippet: sk-rt-d551…
  Labels:  nightly
  Scopes:  batch, internal
```

Optionally add spending limits inline:

| Option | Description |
|--------|-------------|
| `--limit <spec>` | Limit spec: `<model>:<metric>:<windowType>:<period>:<value>` (repeatable) |

Limit spec examples:
- `openai/gpt-5.2:cost:period:monthly:10` - $10/month cap
- `openai/gpt-5.2:calls:rolling:24:hours:500` - 500 calls per rolling 24 h

#### `routerly router token edit <router> <token-id>`

Update tags or spending limits on an existing token.

```bash
routerly router token edit my-api abc123 --tag environment=staging --tag team=qa
```

| Option | Description |
|--------|-------------|
| `--labels <list>` | Replace all labels with this comma-separated list. Omit to keep existing labels unchanged. |
| `--scopes <list>` | Replace all access scopes with this comma-separated list. Omit to keep existing scopes unchanged. |
| `--tag <key=value>` | Replace all tags with these key-value pairs (repeatable). Omit to keep existing tags unchanged. |
| `--add-limit <spec>` | Add a limit (repeatable) |
| `--remove-limit <spec>` | Remove a limit matching model+metric+window (repeatable) |

#### `routerly router token remove <router> <token-id>`

Revoke and delete an API token.

---

### Members - `routerly router member`

#### `routerly router member list <router>`

List router members with their role.

#### `routerly router member add <router>`

```bash
routerly router member add my-api --email user@example.com --role viewer
```

| Option | Description |
|--------|-------------|
| `--email <email>` | Member's email address |
| `--role <role>` | Role to assign (`admin`, `editor`, `viewer`, or a custom role) |

#### `routerly router member set-role <router>`

```bash
routerly router member set-role my-api --email user@example.com --role editor
```

#### `routerly router member remove <router>`

```bash
routerly router member remove my-api --email user@example.com
```

---

### Guardrails - `routerly router guardrails`

Manage the content guardrail configuration for a router. Guardrails evaluate each request and/or response against an ordered list of rules; each enabled rule is evaluated and triggers its configured actions independently.

#### `routerly router guardrails <router>`

Show the current guardrail configuration.

```bash
routerly router guardrails my-api
routerly router guardrails my-api --json   # raw JSON output
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
routerly router guardrails my-api --add-rule
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
routerly router guardrails my-api --remove-rule 2   # delete rule at index 2
```

| Option | Description |
|--------|-------------|
| `--remove-rule <index>` | Remove the security rule at 0-based index |

---

### PII: `routerly router pii`

Manage PII scrubbing policies for a router. PII detection and scrubbing configuration uses policies, each with its own entity set, patterns, direction, and streaming buffer.

#### `routerly router pii list <router>`

List all PII policies for a router.

```bash
routerly router pii list my-api
routerly router pii list my-api --json
```

Output example:

```
PII Policies - my-api
  #   Enabled   Target     Entities
  0   yes       both       EMAIL, PHONE, CREDIT_CARD, SSN, IBAN
  1   yes       request    EMAIL, PHONE
```

Policies are identified by their 0-based index (`#` column).

#### `routerly router pii add <router>`

Add a new PII policy.

```bash
routerly router pii add my-api
```

Launches an interactive wizard. Steps:

1. **Target**: `request`, `response`, or `both` (which side(s) to scrub)
2. **Entities**: comma-separated list of entity types to detect (EMAIL, PHONE, CREDIT_CARD, SSN, IBAN). Leave empty to include none.
3. **Custom patterns**: comma-separated regex patterns to scrub in addition to entity detection. Leave empty for none.
4. **Output buffer size**: (response scrubbing only) suffix buffer size in characters (default 30, valid range: 10 to 500). Used to catch patterns spanning chunk boundaries when streaming. Prompted only when target includes response.

#### `routerly router pii remove <router> <index>`

Remove a PII policy by its 0-based index (from `pii list`).

```bash
routerly router pii remove my-api 0   # Remove the first policy
routerly router pii remove my-api 1   # Remove the second policy
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
  --endpoint http://localhost:4318 \
  --protocol http \
  --header "Authorization: Bearer token" \
  --header "X-Custom: value"
```

| Option | Description |
|--------|-------------|
| `--endpoint <url>` | Required. Base URL of the OTLP receiver (e.g. `http://localhost:4318`). Routerly appends `/v1/metrics`, and `/v1/traces` when trace export is on. |
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

**Trace export** (`otel` and `webhook` only):

| Option | Description |
|--------|-------------|
| `--traces` | Also export request traces, not only metrics |
| `--trace-sample-rate <rate>` | Fraction of traces to export, `0`..`1` (default `1`, all of them) |

```bash
routerly integrations add --type otel --name "Tempo" \
  --endpoint http://localhost:4318 \
  --traces --trace-sample-rate 0.1
```

Passing `--traces` on any other type is an error. See
[`routerly integrations traces`](#routerly-integrations-traces) for what gets exported.

### `routerly integrations traces`

```
routerly integrations traces <id> <on|off> [--sample-rate <rate>]
```

Turns request-trace export on or off for an existing `otel` or `webhook`
integration, without touching its metric export.

| Parameter | Description |
|-----------|-------------|
| `<id>` | Integration ID (full UUID or first 8 chars) |
| `<state>` | `on` or `off` |
| `--sample-rate <rate>` | Fraction of traces to export, `0`..`1` (default `1`); ignored with `off` |

```bash
routerly integrations traces int-uuid2 on --sample-rate 0.25
routerly integrations traces int-uuid2 off
```

What each type receives:

| Type | Shape |
|------|-------|
| `otel` | Native OTLP spans on `<endpoint>/v1/traces`: a `routerly.request` root span with one `routerly.<phase>` child per pipeline phase, and each trace entry as a span event |
| `webhook` | One POST per completed request, `{ "source": "routerly", "type": "trace", "timestamp", "trace": { "id", "routerId", "entries" } }`, signed like the metric payloads when a secret is set |

Sampling is per request and decided once, so a sampled-out request produces no
partial export. Prompts and answers appear in the exported entries only for
routers with trace content enabled (`routerly router edit <router> --trace-content`).

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

Available permissions: `router:read`, `router:write`, `model:read`, `model:write`, `user:read`, `user:write`, `role:write`, `report:read`, `audit:read`, `settings:read`, `settings:write`, `notification:write`, `token:read`, `token:write`.

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

Manage profiles: reusable configuration bundles a router can adopt in place of its own inline setup. A profile has one `kind`:

| Kind | What it bundles |
|------|-----------------|
| `routing` | the ordered policy list |
| `optimizer` | the ordered optimizer pipeline |
| `security` | guardrail rules and PII policies |

A router binds at most one profile per kind, and the three are independent. See [Dashboard: Profiles](../dashboard/profiles.md) for the equivalent UI.

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

The selector and the fallback strategy of a routing profile are engine internals and are not printed; `--json` returns the stored profile as the API serves it, both fields included.

```bash
routerly profiles show auto
routerly profiles show optimizer-balanced --json
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

Delete a user profile. Built-in profiles cannot be deleted, and a profile still assigned to a router is refused.

```bash
routerly profiles delete 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
```

**Output on success:**
```
✓ Profile "8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31" deleted
```

**Error cases:**
- Profile assigned to a router: `Cannot delete "<id>": it is still assigned to a router.`

Requires `profiles:manage` permission.

### `routerly profiles set`

```
routerly profiles set <router> <kind> [profileId] [--none] [--json]
```

Assign or clear the profile of one kind for a router. Provide `profileId` to assign it, or `--none` to clear the assignment and fall back to the router's own inline configuration for that kind. The other two kinds are left untouched.

| Option | Description |
|--------|-------------|
| `--none` | Clear the assignment for this kind |
| `--json` | Output the updated (sanitized) router as raw JSON |

```bash
routerly profiles set my-api routing auto
routerly profiles set my-api optimizer optimizer-aggressive
routerly profiles set my-api security --none
```

**Output on success:**
```
✓ routing profile set to "auto" on router "my-api"
```
(or `✓ security profile cleared on router "my-api"` with `--none`)

**Error cases:**
- Neither `profileId` nor `--none` given: `Error: provide a profileId or --none.`
- Unknown kind: `Unknown kind "<value>". Expected one of: routing, optimizer, security.`
- Router not found: `Router "<name>" not found. Run \`routerly router list\` to see available routers.`

Requires `router:write` permission.

### `routerly profiles get`

```
routerly profiles get <router> [--json]
```

Show which profile each kind is bound to for a router. A kind with no profile assigned prints `custom`, meaning the router uses its own inline configuration. `--json` prints an object keyed by kind, with `null` for unassigned kinds.

```bash
routerly profiles get my-api
routerly profiles get my-api --json
```

No extra permission beyond dashboard authentication: it reads the router list.

Exit code: `0` on success, `1` on error (all subcommands).

---

## `routerly optimizers`

Manage the prompt/context optimizer catalog and a router's per-optimizer
pipeline config. See [Concepts: Optimizers](../concepts/optimizers.md) for
what each optimizer does and its class.

### `routerly optimizers list`

```
routerly optimizers list [--json]
```

List the installed optimizer catalog (all 8 optimizer ids ship built-in;
`installed` reflects whether the module registered itself, which is always
`true` unless a module was intentionally removed from the build).

**Table columns:**
- **ID** - optimizer id
- **Name** - display name
- **Klass** - `lossless` / `recoverable` / `lossy`
- **Installed** - `yes` / `no`
- **Threshold** - accepted range and unit, and the value used when the step
  leaves it unset. `-` when the optimizer takes no threshold

```bash
routerly optimizers list
```
```
┌───────────────┬────────────────────────────────┬─────────────┬───────────┬──────────────────────────────┐
│ ID            │ Name                           │ Klass       │ Installed │ Threshold                    │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ session-dedup │ Session Dedup                  │ lossless    │ yes       │ -                            │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ ccr           │ Conversation Context Reduction │ recoverable │ yes       │ 1-50 turns, default 3        │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ rtk           │ Redundant Token Killer         │ recoverable │ yes       │ -                            │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ headroom      │ Context Headroom               │ lossless    │ yes       │ 0-32768 tokens, default 1024 │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ json-table    │ JSON Table                     │ recoverable │ yes       │ 2-500 rows, default 5        │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ relevance     │ Relevance Filter               │ lossy       │ yes       │ 0-1 ratio, default 0.1       │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ caveman       │ Caveman                        │ lossy       │ yes       │ -                            │
├───────────────┼────────────────────────────────┼─────────────┼───────────┼──────────────────────────────┤
│ llmlingua-2   │ LLMLingua-2                    │ lossy       │ yes       │ 0.05-0.95 ratio, default 0.5 │
└───────────────┴────────────────────────────────┴─────────────┴───────────┴──────────────────────────────┘
```

`required` in the threshold column would mean an optimizer with no default,
which stays inert until a router sets one. No shipped optimizer is in that
state today.

```bash
routerly optimizers list --json
```
```json
[
  {
    "id": "session-dedup",
    "klass": "lossless",
    "installed": true,
    "label": "Session Dedup",
    "description": "Drops exact-duplicate repeated messages within a conversation, keeping the first and last of any run."
  },
  {
    "id": "ccr",
    "klass": "recoverable",
    "installed": true,
    "label": "Conversation Context Reduction",
    "description": "Keeps the system prefix and the most recent turns; older turns are condensed into a single compact block.",
    "threshold": {
      "label": "Recent turns to keep",
      "unit": "turns",
      "min": 1,
      "max": 50,
      "step": 1,
      "default": 3,
      "help": "Fewer turns means a shorter prompt and less history for the model to work with."
    }
  }
]
```

The `label`, `description` and `threshold` fields come from the shared
optimizer catalog, the same source the dashboard reads, so both surfaces
describe an optimizer identically. `threshold` is absent for optimizers that
take none.

Requires `optimizers:read` permission.

### `routerly optimizers fixtures`

```
routerly optimizers fixtures [--json]
```

List the sample conversations shipped with Routerly. Feed one to
[`optimizers preview --fixture`](#routerly-optimizers-preview). Each is
written to exercise a different group of steps, because a short invented
prompt lacks the repetition and history optimizers cut.

```bash
routerly optimizers fixtures
```
```
┌──────────────────┬────────────────────────────────────────────────┬──────┬──────────┬───────────────────────────────────────────────────────┐
│ ID               │ Name                                           │ Lang │ Messages │ Exercises                                             │
├──────────────────┼────────────────────────────────────────────────┼──────┼──────────┼───────────────────────────────────────────────────────┤
│ support-chat-en  │ Support chat (English, 17 messages)             │ en   │ 17       │ session-dedup, ccr, rtk, relevance and caveman         │
├──────────────────┼────────────────────────────────────────────────┼──────┼──────────┼───────────────────────────────────────────────────────┤
│ brief-en         │ Long brief (English, single turn)              │ en   │ 1        │ caveman and llmlingua-2                               │
├──────────────────┼────────────────────────────────────────────────┼──────┼──────────┼───────────────────────────────────────────────────────┤
│ agent-tools-en   │ Coding agent with tool results (16 messages)    │ en   │ 16       │ json-table, session-dedup, rtk and ccr                │
├──────────────────┼────────────────────────────────────────────────┼──────┼──────────┼───────────────────────────────────────────────────────┤
│ long-context-en  │ Incident log triage (English, very long)        │ en   │ 91       │ headroom, previewed against a 32k window or smaller   │
└──────────────────┴────────────────────────────────────────────────┴──────┴──────────┴───────────────────────────────────────────────────────┘
```

`--json` prints the fixtures whole, messages included.

These conversations ship with Routerly, are identical on every install, and
are the only preview material: the service never records real prompts (see
[Concepts: Optimizers, Privacy](../concepts/optimizers.md#privacy)).

No permission beyond dashboard authentication: the fixtures are in the CLI
itself and the command makes no API call.

### `routerly optimizers model`

```
routerly optimizers model [--install [key]] [--json]
```

Show, and install, the optional LLMLingua-2 checkpoints on the **service
host**. Checkpoints are shared by every router; which one a router uses is
set with [`optimizers config --checkpoint`](#routerly-optimizers-config).

| Option | Description |
|--------|-------------|
| `--install [key]` | Start a checkpoint's download, the default one when no key is given |
| `--json` | Output the raw model state as JSON |

```bash
routerly optimizers model
```
```
runtime: installed
┌───────────────────────────────┬───────────────────────────────┬────────┬──────────────────────────┬──────────────────────────────────────┐
│ Key                           │ Name                          │ Size   │ State                    │ Notes                                │
├───────────────────────────────┼───────────────────────────────┼────────┼──────────────────────────┼──────────────────────────────────────┤
│ bert-multilingual-q8 (default)│ BERT multilingual, quantized  │ 182 MB │ downloading 42% 76/182 MB│ The default. Smallest and fastest... │
├───────────────────────────────┼───────────────────────────────┼────────┼──────────────────────────┼──────────────────────────────────────┤
│ xlm-roberta-large-int8        │ XLM-RoBERTa large, int8       │ 579 MB │ absent                   │ Better compression quality...        │
├───────────────────────────────┼───────────────────────────────┼────────┼──────────────────────────┼──────────────────────────────────────┤
│ bert-multilingual-fp32        │ BERT multilingual, full prec. │ 713 MB │ ready                    │ Same model without quantization...   │
└───────────────────────────────┴───────────────────────────────┴────────┴──────────────────────────┴──────────────────────────────────────┘
Downloading. Run `routerly optimizers model` again to check progress.
```

`(default)` marks the checkpoint a step with no checkpoint of its own runs
on. The service reports it, so an `ROUTERLY_LLMLINGUA_MODEL` override on the
host shows up here.

```bash
routerly optimizers model --install
routerly optimizers model --install xlm-roberta-large-int8
```

The download runs on the service host, not here, and is hundreds of
megabytes: `--install` returns as soon as it has started, and the command
run again reports progress. A failed download reads `failed` in the State
column and prints its reason to stderr; running `--install` again retries.

**Error cases:**
```bash
routerly optimizers model --install
```
```
Error: @huggingface/transformers is not installed on the service host
```
```bash
routerly optimizers model --install not-a-checkpoint
```
```
Error: Unknown checkpoint not-a-checkpoint
```

See [Concepts: Optimizers,
llmlingua-2](../concepts/optimizers.md#llmlingua-2) for what to install on
the host first, and what each checkpoint costs.

`optimizers:read` to show, `optimizers:manage` to install.

### `routerly optimizers config`

```
routerly optimizers config <router> [--enable id] [--disable id] [--threshold id=val] [--checkpoint key] [--order ids] [--json]
```

Read-modify-write a router's `optimizers.steps`. Run with no flags to print
the current pipeline unchanged.

| Option | Description |
|--------|-------------|
| `--enable <id>` | Enable an optimizer step (repeatable) |
| `--disable <id>` | Disable an optimizer step (repeatable) |
| `--threshold <id=val>` | Set an optimizer step's threshold, range depends on the optimizer id (repeatable), see [Threshold Range](../concepts/optimizers.md#threshold-range) |
| `--checkpoint <key>` | LLMLingua-2 checkpoint this router runs on, from [`optimizers model`](#routerly-optimizers-model) |
| `--order <ids>` | Comma-separated optimizer ids controlling step order |
| `--json` | Output the updated (sanitized) router as raw JSON |

`--enable`/`--disable`/`--threshold` create the step if it is not already
configured (new steps default to `enabled: false` unless `--enable` is also
given for that id). `--checkpoint` lands on the `llmlingua-2` step, the only
one that runs on a model, creating it the same way. `--order` stable-sorts
existing steps to the given id order; ids not listed keep their relative
order at the end.

```bash
routerly optimizers config Test --order session-dedup,caveman,rtk,relevance,ccr
```
```
✓ Updated optimizer pipeline on router "Test"
┌───┬───────────────┬────────────────────────────────┬─────────┬─────────────┬────────────┐
│ # │ ID            │ Name                           │ Enabled │ Threshold   │ Checkpoint │
├───┼───────────────┼────────────────────────────────┼─────────┼─────────────┼────────────┤
│ 1 │ session-dedup │ Session Dedup                  │ yes     │ -           │ -          │
├───┼───────────────┼────────────────────────────────┼─────────┼─────────────┼────────────┤
│ 2 │ caveman       │ Caveman                        │ yes     │ -           │ -          │
├───┼───────────────┼────────────────────────────────┼─────────┼─────────────┼────────────┤
│ 3 │ rtk           │ Redundant Token Killer         │ yes     │ -           │ -          │
├───┼───────────────┼────────────────────────────────┼─────────┼─────────────┼────────────┤
│ 4 │ relevance     │ Relevance Filter               │ yes     │ 0.3         │ -          │
├───┼───────────────┼────────────────────────────────┼─────────┼─────────────┼────────────┤
│ 5 │ ccr           │ Conversation Context Reduction │ no      │ 3 (default) │ -          │
└───┴───────────────┴────────────────────────────────┴─────────┴─────────────┴────────────┘
```

A step that leaves its threshold unset shows the value it will run with,
marked `(default)`; `-` means the optimizer takes no threshold at all. The
**Checkpoint** column is `-` on every step but `llmlingua-2`, which shows the
key it runs on, or `-` for the host's default.

```bash
routerly optimizers config Test --enable llmlingua-2 --checkpoint xlm-roberta-large-int8
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
ratio); `ccr`, `headroom` and `json-table` accept any positive number (a turn
count, a token budget and a row count respectively). See [Concepts:
Optimizers, Threshold Range](../concepts/optimizers.md#threshold-range).
```bash
routerly optimizers config Test --checkpoint not-a-checkpoint
```
```
Error: Invalid optimizers config
```
The checkpoint must be one the service publishes, see [`optimizers
model`](#routerly-optimizers-model).
```bash
routerly optimizers config nonexistent-router-xyz --enable rtk
```
```
Router "nonexistent-router-xyz" not found. Run `routerly router list` to see available routers.
```

Requires `optimizers:manage` permission.

### `routerly optimizers preview`

```
routerly optimizers preview <router> (--message <text> ... | --fixture <id>) [--model <id>] [--json]
```

Dry-run the router's currently configured optimizer pipeline against a
sample message list. No upstream call is made and the router's config is
not modified.

| Option | Description |
|--------|-------------|
| `--message <text>` | Sample user message (repeatable) |
| `--fixture <id>` | Use a shipped sample conversation instead, from [`optimizers fixtures`](#routerly-optimizers-fixtures) |
| `--model <id>` | Address the sample to this model, so context-window steps have a window to fit |
| `--json` | Output the raw preview result as JSON |

Exactly one prompt source is required: give `--message` at least once, or
`--fixture`, not both.

`--model` matters to `headroom`, which sizes its budget on the requested
model's context window. Without it the sample is addressed to no model and
that step reports it has nothing to size against instead of trimming, which
is exactly what a live request naming an unknown model does.

```bash
routerly optimizers preview Test \
  --message "The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. Please remember: the quick brown fox jumps over the lazy dog." \
  --message "What is the capital of France?"
```
```
Tokens before: 46
Tokens after:  32
Saved:         14

┌───────────────┬────────────────────────────────┬────────┬───────┬───────┬───────────────────────────────────────────────────────────┐
│ ID            │ Name                           │ Before │ After │ Saved │ Note                                                      │
├───────────────┼────────────────────────────────┼────────┼───────┼───────┼───────────────────────────────────────────────────────────┤
│ ccr           │ Conversation Context Reduction │ 46     │ 46    │ 0     │ Conversation has 2 turns; condensing starts above 3.      │
├───────────────┼────────────────────────────────┼────────┼───────┼───────┼───────────────────────────────────────────────────────────┤
│ session-dedup │ Session Dedup                  │ 46     │ 46    │ 0     │ No message repeats three or more times in a row.          │
├───────────────┼────────────────────────────────┼────────┼───────┼───────┼───────────────────────────────────────────────────────────┤
│ caveman       │ Caveman                        │ 46     │ 32    │ 14    │                                                           │
├───────────────┼────────────────────────────────┼────────┼───────┼───────┼───────────────────────────────────────────────────────────┤
│ rtk           │ Redundant Token Killer         │ 32     │ 32    │ 0     │ No redundant whitespace or repeated block found.          │
├───────────────┼────────────────────────────────┼────────┼───────┼───────┼───────────────────────────────────────────────────────────┤
│ headroom      │ Context Headroom               │ 32     │ 32    │ 0     │ No context window known for the requested model (unnamed).│
└───────────────┴────────────────────────────────┴────────┴───────┴───────┴───────────────────────────────────────────────────────────┘
```

Preview something that resembles real traffic by running a fixture, and name
a model so the context-window steps have a window:

```bash
routerly optimizers fixtures
routerly optimizers preview Test --fixture support-chat-en
routerly optimizers preview Test --fixture long-context-en --model ollama/qwen3:4b
```

The per-step table lists every configured step in pipeline order, including
disabled ones (`Saved: 0` for a disabled or no-op step). **Note** carries the
step's own reason when it declined to run, so a `0` that means "nothing to
do" is not confused with one that means "never ran". A step whose result was
rejected by the safety gate reads `rolled back` instead of a number,
followed by:

```
A rolled-back step produced a prompt the service judged unsafe, so its change was discarded.
```

That distinction matters when tuning: a `0` means the step had nothing to
do, a rollback means it went too far and the threshold needs raising. Token
counts are the `chars / 4` approximation used by the live pipeline, not a
provider-exact tokenizer.

With `--json`, each `perStep` entry also carries the prompt as that step left
it, so a script can diff step against step (see [API: Preview
Optimizers](../api/management.md#preview-optimizers)).

**Error cases:**
```bash
routerly optimizers preview Test
```
```
Error: provide at least one --message, or --fixture <id>.
```
```bash
routerly optimizers preview Test --message "hi" --fixture brief-en
```
```
Error: --message and --fixture are mutually exclusive.
```
```bash
routerly optimizers preview Test --fixture nope
```
```
Error: unknown fixture "nope". Available: support-chat-en, brief-en, agent-tools-en, long-context-en.
```

Requires `optimizers:read` permission.

Exit code: `0` on success, `1` on error (all subcommands).

---

## `routerly experiments`

Run A/B tests that route each call to one of several routers. A variant is
an existing router taken whole, so two model sets, two routing profiles or
two optimizer pipelines become directly comparable on cost, latency, errors
and judge score. See [Concepts: Experiments](../concepts/experiments.md) for
how a test lives and how the numbers are computed, and
[Dashboard: Experiments](../dashboard/experiments.md) for the same thing in
the browser.

| Rotation | Behaviour |
|----------|-----------|
| `sticky` | The same caller keeps the same variant for the whole conversation. Default |
| `weighted` | Every request draws a variant independently, with the share each variant declares |
| `round-robin` | Requests alternate between variants in order |

Every subcommand answers the same way when the module is off:

```
The experiments module is disabled. Enable it with: routerly modules enable experiments
```

### `routerly experiments list`

```
routerly experiments list [--json]
```

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON |

**Table columns:**
- **ID** - experiment id
- **Name** - experiment name
- **Rotation** - the rotation's display label
- **Variants** - number of arms
- **Created** - creation date

```bash
routerly experiments list
```
```
┌──────────────────────────────────────┬──────────────────┬────────────────────┬──────────┬────────────┐
│ ID                                   │ Name             │ Rotation           │ Variants │ Created    │
├──────────────────────────────────────┼──────────────────┼────────────────────┼──────────┼────────────┤
│ 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31 │ Cheap vs premium │ Sticky per session │ 2        │ 8/1/2026   │
└──────────────────────────────────────┴──────────────────┴────────────────────┴──────────┴────────────┘
```

With no experiments yet:
```
No experiments found.
```

Requires `experiments:read` permission.

### `routerly experiments show`

```
routerly experiments show <id> [--json]
```

Print one experiment with its variants and tokens. The variant table shows
router **names**, the same values `--variant` takes; ids stay in `--json`.

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON |

**Variant columns:** ID, Label,
Router (`<id> (deleted)` in red when the router is gone), Weight (`1` when
unset).

**Token columns:** ID, Token (first characters only), Created, Last used
(`never` until the token serves a call).

```bash
routerly experiments show 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
```
```
id:          8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
name:        Cheap vs premium
description: Is the cheap model good enough for support replies?
rotation:    Sticky per session, on automatic
created:     8/1/2026, 10:12:03 AM
judge:       gpt-4o, 20% of calls
             - Answers the question asked
             - No invented facts

Variants:
┌──────────────────────────────────────┬─────────┬─────────────┬────────┐
│ ID                                   │ Label   │ Router     │ Weight │
├──────────────────────────────────────┼─────────┼─────────────┼────────┤
│ 4d3b2a10-8c7e-4f21-9b0d-1e2f3a4b5c6d │ Cheap   │ cheap-api   │ 1      │
├──────────────────────────────────────┼─────────┼─────────────┼────────┤
│ 6a1c9e07-5b3d-42f8-8e10-7c4d9f2b0a35 │ Premium │ premium-api │ 1      │
└──────────────────────────────────────┴─────────┴─────────────┴────────┘

Tokens:
┌──────────────────────────────────────┬──────────────┬────────────────────────┬───────────┐
│ ID                                   │ Token        │ Created                │ Last used │
├──────────────────────────────────────┼──────────────┼────────────────────────┼───────────┤
│ b7e5c3a1-9f2d-4e60-a8b3-0c1d2e3f4a5b │ sk-rt-2246a1 │ 8/1/2026, 10:12:03 AM  │ never     │
└──────────────────────────────────────┴──────────────┴────────────────────────┴───────────┘
```

Requires `experiments:read` permission.

### `routerly experiments create`

```
routerly experiments create --name <name> [--description <text>] [--rotation <rotation>]
  [--sticky-key <key>] [--variant <spec>] [--judge-model <modelId>] [--criteria <text>]
  [--sample-rate <percent>] [--min-samples <n>] [--json]
```

Create an experiment with its first token. It routes traffic from the moment
it exists: there is no start step.

| Option | Description |
|--------|-------------|
| `--name <name>` | Required |
| `--description <text>` | What this test is trying to settle |
| `--rotation <rotation>` | `sticky` (default), `weighted`, `round-robin` |
| `--sticky-key <key>` | `auto` (default), `end-user`, `conversation`, `client`. Read only by `sticky` |
| `--variant <spec>` | An arm of the test: `<router>[:label][=weight]`. Repeat for each variant |
| `--judge-model <modelId>` | Score answers with this model |
| `--criteria <text>` | One judge criterion. Repeat for each |
| `--sample-rate <percent>` | Share of calls the judge scores, `0`-`100` (default `100`) |
| `--min-samples <n>` | Calls per variant below which the comparison is not conclusive (default `30`) |
| `--json` | Output raw JSON |

One `--variant` carries a whole arm: `cheap-api` is the router alone,
`cheap-api:Cheap` renames it in the tables, `cheap-api=80` gives it a weight.
The router is taken by name or by id.

`--help` lists every rotation and sticky key with its one-line meaning,
generated from the same catalog the dashboard reads.

```bash
routerly experiments create --name "Cheap vs premium" \
  --variant cheap-api --variant premium-api
```
```
✓ Experiment "Cheap vs premium" created -> 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31

Token (shown once, point your client at it instead of a router token):
sk-rt-2246a1f0c8b34d17a9e05c2b6f8d41e37a0b9c5d8e2f1a4b7c6d0e9f3a2b5c8
```

```bash
routerly experiments create --name "Split 80/20" --rotation weighted \
  --variant cheap-api=80 --variant premium-api=20
```

```bash
routerly experiments create --name "Prompt test" \
  --variant a:Baseline --variant b:Rewritten \
  --judge-model gpt-4o --criteria "Answers the question asked" --sample-rate 20
```

**Error cases:**
```bash
routerly experiments create --name Test --variant ":Label"
```
```
Invalid --variant ":Label". Expected <router>[:label][=weight].
```
```bash
routerly experiments create --name Test --variant "cheap-api=-1"
```
```
Invalid weight in --variant "cheap-api=-1". Expected a number >= 0.
```
```bash
routerly experiments create --name Test --variant nonexistent-router-xyz
```
```
Router "nonexistent-router-xyz" not found. Run `routerly router list` to see available routers.
```
```bash
routerly experiments create --name Test --criteria "Is correct"
```
```
Error: --criteria and --sample-rate need --judge-model.
```

Requires `experiments:manage` permission.

### `routerly experiments update`

```
routerly experiments update <id> [--name <name>] [--description <text>] [--rotation <rotation>]
  [--sticky-key <key>] [--variant <spec>] [--judge-model <modelId>] [--criteria <text>]
  [--sample-rate <percent>] [--no-judge] [--min-samples <n>] [--json]
```

Same flags as `create`, plus `--no-judge`. Only the fields actually passed
are sent, so an update never rewrites what it was not asked to change.
`--variant` and `--criteria` replace the whole list rather than appending to
it.

Every field stays editable for the whole life of the experiment, including
one already serving traffic. Redesigning a test that already has traffic mixes
two different measurements under one set of numbers, so narrow the metrics
window to the period after the change.

```bash
routerly experiments update 8f2c1d64 --name "Cheap vs premium, take 2"
```
```
✓ Experiment "Cheap vs premium, take 2" updated
```

```bash
routerly experiments update 8f2c1d64 --rotation weighted \
  --variant cheap-api=70 --variant premium-api=30
```

```bash
routerly experiments update 8f2c1d64 --no-judge
```

**Error cases:**
```bash
routerly experiments update 8f2c1d64
```
```
Error: nothing to update. Pass at least one field.
```
```bash
routerly experiments update 8f2c1d64 --no-judge --judge-model gpt-4o
```
```
Error: --no-judge and --judge-model cannot be used together.
```
```bash
routerly experiments update 8f2c1d64 --no-judge
```
```
This experiment has no judge to disable.
```

Requires `experiments:manage` permission.

### `routerly experiments metrics`

```
routerly experiments metrics <id> [--days <n>] [--from <iso>] [--to <iso>] [--json]
```

Compare the variants on cost, latency, errors and judge score, over the
window. With no window flags the whole history of the experiment is measured.

| Option | Description |
|--------|-------------|
| `--days <n>` | Only the last N days, `1`-`3650` |
| `--from <iso>` | Start of the window, ISO 8601 |
| `--to <iso>` | End of the window, ISO 8601 |
| `--json` | Output raw JSON |

`--from` overrides the start `--days` computed, so the two are not meant to
be combined.

A bare day (`--to 2026-08-01`) covers that whole day, the same window the
dashboard picker asks for. A full instant is taken as given.

**Table columns:** Variant (with `(low sample)` below the minimum), Calls,
Errors (count and rate), Tokens in / out, Cost, Cost / call, Avg latency,
p95, TTFT (mean time to first token on streamed calls), Judge score (mean out
of 10, with the judged-call count).

The judge score is the only column the window does not narrow: it is a running
average kept on the experiment, so it always reads over the experiment's whole
life, and its call count can exceed the calls measured in the window.

```bash
routerly experiments metrics 8f2c1d64 --days 7
```
```
4 calls measured

┌──────────────────────┬───────┬───────────┬─────────────────┬──────────┬─────────────┬─────────────┬───────────┬────────┬──────────────┐
│ Variant              │ Calls │    Errors │ Tokens in / out │     Cost │ Cost / call │ Avg latency │       p95 │   TTFT │  Judge score │
├──────────────────────┼───────┼───────────┼─────────────────┼──────────┼─────────────┼─────────────┼───────────┼────────┼──────────────┤
│ Cheap (low sample)   │     2 │ 1 (50.0%) │     1,204 / 318 │ $0.00012 │    $0.00006 │   114289 ms │ 114289 ms │      - │            - │
├──────────────────────┼───────┼───────────┼─────────────────┼──────────┼─────────────┼─────────────┼───────────┼────────┼──────────────┤
│ Premium (low sample) │     2 │         0 │     1,204 / 402 │ $0.00240 │    $0.00120 │      881 ms │    881 ms │ 612 ms │ 8.5 / 10 (2) │
└──────────────────────┴───────┴───────────┴─────────────────┴──────────┴─────────────┴─────────────┴───────────┴────────┴──────────────┘

Not conclusive yet: every variant needs at least 30 calls in this window.
```

Only the client's own calls are counted. Router decision calls, guardrail
passes and the judge's own verdicts are gateway overhead and stay out of the
comparison.

```bash
routerly experiments metrics 8f2c1d64
```
```
No calls in this window yet. Point a client at the experiment token to start the comparison.
```

**Error cases:**
```bash
routerly experiments metrics 8f2c1d64 --from yesterday
```
```
Invalid --from "yesterday". Expected an ISO 8601 date, e.g. 2026-08-01T00:00:00Z.
```

Requires `experiments:read` permission.

### `routerly experiments delete`

```
routerly experiments delete <id>
```

Delete an experiment. Its tokens stop working immediately, so move clients to
a router token first.

```bash
routerly experiments delete 8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31
```
```
✓ Experiment "8f2c1d64-2f1e-4c0a-9a1b-6b5c2d0e7f31" deleted
```

Requires `experiments:manage` permission.

### `routerly experiments token`

```
routerly experiments token list <id> [--json]
routerly experiments token create <id> [--json]
routerly experiments token revoke <id> <tokenId>
```

The tokens clients call to reach the experiment. Same shape as a router
token, `sk-rt-...`, and used the same way: same base URL, this value in
place of a router token. Each request lands on one variant and is billed to
that variant's router.

```bash
routerly experiments token list 8f2c1d64
```
```
┌──────────────────────────────────────┬──────────────┬────────────────────────┬────────────────────────┐
│ ID                                   │ Token        │ Created                │ Last used              │
├──────────────────────────────────────┼──────────────┼────────────────────────┼────────────────────────┤
│ b7e5c3a1-9f2d-4e60-a8b3-0c1d2e3f4a5b │ sk-rt-2246a1 │ 8/1/2026, 10:12:03 AM  │ 8/1/2026, 10:41:55 AM  │
└──────────────────────────────────────┴──────────────┴────────────────────────┴────────────────────────┘
```

```bash
routerly experiments token create 8f2c1d64
```
```
✓ Token created. Copy it now, it will not be shown again:
sk-rt-91b0d4e7c2a58f36b1d09e4c7a2f5b8d3e6c1a0f9b4d7e2c5a8f1b6d3e0c9a4
```

```bash
routerly experiments token revoke 8f2c1d64 b7e5c3a1-9f2d-4e60-a8b3-0c1d2e3f4a5b
```
```
✓ Token "b7e5c3a1-9f2d-4e60-a8b3-0c1d2e3f4a5b" revoked
```

An experiment with no tokens prints `No tokens on this experiment.`

What a client gets back: the provider's own response once a variant is
resolved, `401 Token expired` past the token's expiry, and
`503 experiment_misconfigured` when no variant points at an existing router.

`token list` requires `experiments:read`; `create` and `revoke` require
`experiments:manage`.

Exit code: `0` on success, `1` on error (all subcommands).

---

## `routerly clients`

Connect local AI clients to Routerly. Unlike the rest of the CLI, these
commands write files on **this machine** (your workstation running the CLI),
not on the Routerly server: they edit the config file of a client tool
installed locally. Clients that Routerly cannot safely write for get their
manual steps printed instead. See [Integrations: Connect a
client](../integrations/overview.md#connect-a-client) for one reference page
per client, and [Dashboard: Connect](../dashboard/connect.md) for the same
steps in the browser.

These commands require a logged-in session (`routerly auth login`). No
specific permission is required for `list`, `endpoints`, `inspect`, `doctor`, `undo`,
`launch`, or `configure --token <token>` (reusing an existing token skips
minting). Minting a new token via `configure` (the default, when `--token`
is omitted) requires `router:write` permission on the target router.

### `routerly clients list`

```
routerly clients list [--json]
```

List every supported client with its support level and connect modes.

**Table columns:**
- **ID**: client identifier, used by `inspect`/`configure`/`launch`
- **Label**: display name
- **Support**: `auto-configurable` (green, `configure` writes the file for
  you), `launchable` (green), `documented` (gray, manual-only, no file this
  CLI can safely write), `partial`/`stale` (yellow)
- **Modes**: `llm` (the client's model traffic goes through Routerly),
  `mcp` (the client loads Routerly as an MCP server), or both

```bash
routerly clients list
```
```
┌───────────────────┬───────────────────────┬───────────────────┬──────────┐
│ ID                │ Label                 │ Support           │ Modes    │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ claude-code       │ Claude Code           │ auto-configurable │ llm, mcp │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ claude-desktop    │ Claude Desktop        │ documented        │ mcp      │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ codex             │ Codex                 │ auto-configurable │ llm, mcp │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ opencode          │ OpenCode              │ auto-configurable │ llm, mcp │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ openclaw          │ OpenClaw              │ documented        │ llm, mcp │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ continue          │ Continue              │ auto-configurable │ llm      │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ cursor            │ Cursor                │ documented        │ llm, mcp │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ cline             │ Cline                 │ documented        │ llm, mcp │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ zed               │ Zed                   │ documented        │ llm, mcp │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ generic-openai    │ Any OpenAI SDK app    │ documented        │ llm      │
├───────────────────┼───────────────────────┼───────────────────┼──────────┤
│ generic-anthropic │ Any Anthropic SDK app │ documented        │ llm      │
└───────────────────┴───────────────────────┴───────────────────┴──────────┘
```

With `--json`, each entry carries `id`, `label`, `supportState` and `modes`:

```json
[
  {
    "id": "claude-code",
    "label": "Claude Code",
    "supportState": "auto-configurable",
    "modes": ["llm", "mcp"]
  }
]
```

### `routerly clients endpoints`

```
routerly clients endpoints [--json]
```

Print what any OpenAI- or Anthropic-compatible client needs, whether or not
it appears in `clients list`: the two base URLs, how the key travels, and the
model to ask for. Nothing else changes on the client side, since requests and
responses cross Routerly untouched.

```bash
routerly clients endpoints
```
```
Point any client here
  OpenAI base URL:     http://localhost:3000/v1
  Anthropic base URL:  http://localhost:3000
  API key:             a router token, as Authorization: Bearer or x-api-key
  Model:               routerly/ada (Routerly picks), or any model id
  From other machines: 192.168.1.116, 192.168.1.111
```

`routerly/ada` hands the model choice to the router; any model id from
`routerly models list` works in its place. Mint the token with
`routerly router token create <router>`.

With `--json`:

```json
{
  "openaiBaseUrl": "http://localhost:3000/v1",
  "anthropicBaseUrl": "http://localhost:3000",
  "model": "routerly/ada",
  "advertisedAddresses": ["192.168.1.116", "192.168.1.111"]
}
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
routerly clients configure <id> [--router <id>] [--token <token>] [--yes] [--json]
```

Write Routerly connection settings into a client's own config file. Shows a
before/after plan, then applies it.

| Option | Description |
|--------|-------------|
| `--router <id>` | Router name or ID to mint/use a token for (prompts with a picker if omitted) |
| `--token <token>` | Use this token instead of minting a new one, skips the consent prompt |
| `--yes` | Skip the consent prompt without supplying `--token` (a new token is still minted) |
| `--json` | Output `{ plan, applied, validated }` as JSON instead of the human-readable plan |

**Mint vs. `--token`:** by default `configure` mints a brand-new router
token via `POST /api/routers/:id/tokens` and asks for confirmation first
(`Mint a new Routerly token for router "…" to configure …?`). Pass an
existing token with `--token` to reuse it instead. No new token is created
and no prompt is shown. `--yes` skips the confirmation prompt but still
mints a new token; use `--token` if you don't want a new token minted at all.

```bash
routerly clients configure opencode --router Test --token sk-rt-YOUR_ROUTER_TOKEN
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
        "apiKey": "sk-rt-YOUR_ROUTER_TOKEN"
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

**Clients configured by hand** (`documented`) never have their file touched.
`configure` prints the steps, with a real token, and exits `0`:

```bash
routerly clients configure cline --router Test --token sk-rt-YOUR_ROUTER_TOKEN
```
```
Cline: is configured by hand

Cline panel > settings (gear icon):
1. API Provider: OpenAI Compatible.
2. Base URL: http://localhost:3000/v1
3. API Key: sk-rt-YOUR_ROUTER_TOKEN
4. Model ID: routerly/ada, or any model registered in your router.

Docs: https://doc.routerly.ai/next/integrations/clients/cline
```

Clients with a config file print the path plus the block to paste (Zed,
`~/.config/zed/settings.json`); clients configured through environment
variables print the variables (`generic-openai`, `generic-anthropic`).

**MCP-only clients** print the `mcpServers` block and the command that mints
the token. No router token is involved, so `--router` is not needed:

```bash
routerly clients configure claude-desktop
```
```
Claude Desktop: connects over MCP only
  Config file: ~/Library/Application Support/Claude/claude_desktop_config.json

{
  "mcpServers": {
    "routerly": {
      "command": "routerly",
      "args": [
        "mcp",
        "serve"
      ],
      "env": {
        "ROUTERLY_MCP_TOKEN": "<YOUR_MCP_TOKEN>"
      }
    }
  }
}

Docs: https://doc.routerly.ai/next/integrations/clients/claude-desktop
Create the token with `routerly mcp token create claude-desktop`.
```

See [`routerly mcp`](#routerly-mcp) for the token commands.

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

Inspect and exercise the [MCP server](../concepts/mcp.md): the tools Routerly
exposes to MCP clients (Claude Code, Claude Desktop, Codex, OpenCode,
OpenClaw, and similar) over `/mcp`, plus the personal tokens those clients
authenticate with.

MCP is per-user: a token acts as its owner and exposes exactly the tools that
owner's role permits. `test` and `serve` need one, and resolve it in this
order:

1. `--token <token>`
2. the `ROUTERLY_MCP_TOKEN` environment variable
3. a token named `routerly-cli`, revoked and re-minted on each run

The third path exists because stored tokens are hashed and cannot be read
back: the CLI can only use a token it has just created. Pass `--token` or
export `ROUTERLY_MCP_TOKEN` to keep a long-lived token of your own instead.

### `routerly mcp tools`

```
routerly mcp tools [--json]
```

List the MCP tools your permissions expose (`GET /api/me/mcp-tools`). A tool
is listed only when your role holds the permission gating it and its backing
module is bootstrapped on this instance.

```bash
routerly mcp tools
```
```
┌──────────────────────┬───────┬───────────────────────┬───────────────┐
│ Name                 │ Scope │ Module                │ Permission    │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ list_models          │ read  │ catalog.registry      │ model:read    │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ get_model            │ read  │ catalog.registry      │ model:read    │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ route_preview        │ read  │ routing.router        │ router:read  │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ get_usage_summary    │ read  │ usage.tracker         │ report:read   │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ get_budget_status    │ read  │ cost.budget           │ report:read   │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ get_metrics_snapshot │ read  │ observability.registry│ report:read   │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ list_routers        │ read  │ config.store          │ router:read  │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ create_router_token │ write │ config.store          │ token:write   │
├──────────────────────┼───────┼───────────────────────┼───────────────┤
│ toggle_model         │ write │ config.store          │ router:write │
└──────────────────────┴───────┴───────────────────────┴───────────────┘
```

A role holding none of these permissions gets
`No MCP tool is available to your role.`

### `routerly mcp test`

```
routerly mcp test <tool> [--input <json>] [--token <token>] [--json]
```

Invoke one tool over the live `/mcp` transport with a real MCP token, useful
to verify a tool works before wiring a client to it.

| Option | Description |
|--------|-------------|
| `--input <json>` | Tool arguments as a JSON object (default `{}`) |
| `--token <token>` | Use an explicit MCP token instead of the CLI one |
| `--json` | Output the raw tool result as JSON |

```bash
routerly mcp test get_model --input '{"id":"openai/gpt-5.2"}'
```
```
{
  "id": "openai/gpt-5.2",
  "provider": "openai",
  "contextWindow": 400000
}
```

**Error cases:**
- `--input` is not valid JSON: `Error: --input must be valid JSON.` (checked before any network call or token minting)
- Token unknown or revoked: `Error: Invalid MCP token.`
- Token past its expiry: `Error: MCP token expired.`
- Role lacks the tool's permission: `Error: Permission denied: <permission> is required to call <tool>.`
- Tool call fails (e.g. unknown id): the tool's `isError` message, printed to stderr

### `routerly mcp serve`

```
routerly mcp serve [--token <token>]
```

Run the MCP server over stdio for local clients (Claude Desktop and similar).
Resolves an MCP token, then spawns the Routerly service binary with
`ROUTERLY_MCP_STDIO=1` and `ROUTERLY_MCP_TOKEN=<token>` set. See
[Reference: Environment Variables](../reference/environment-variables.md#mcp-server-variables).
This is the command a client's MCP config points its `command`/`args` at.

| Option | Description |
|--------|-------------|
| `--token <token>` | Use an explicit MCP token instead of the CLI one |

```bash
routerly mcp serve
```
```
Starting MCP stdio server...
```

With `--token` or `ROUTERLY_MCP_TOKEN` set, no CLI login is needed: a desktop
client can spawn this command with the token in its own environment. Without
either, the CLI mints its token through the API and therefore needs an active
account.

Diagnostics print to stderr only; stdout is reserved for the MCP protocol
stream. The process stays attached until the client disconnects; the CLI
propagates the child process's exit code.

### `routerly mcp token`

Manage your personal MCP tokens. Same tokens as the dashboard's
[Profile: MCP tab](../dashboard/profile.md#mcp-tab); they are yours only, no
permission beyond being logged in is required.

#### `routerly mcp token list`

```
routerly mcp token list [--json]
```

```bash
routerly mcp token list
```
```
┌──────────────────────────────────────┬─────────────┬─────────────────┬──────────────────┬──────────────────┬────────────┐
│ ID                                   │ Name        │ Snippet         │ Created          │ Last used        │ Expires    │
├──────────────────────────────────────┼─────────────┼─────────────────┼──────────────────┼──────────────────┼────────────┤
│ 2f1c0b8a-...                         │ laptop      │ sk-rt-mcp-8f3c…  │ 01/07/2026 09:12 │ 31/07/2026 18:40 │ —          │
└──────────────────────────────────────┴─────────────┴─────────────────┴──────────────────┴──────────────────┴────────────┘
```

Only the snippet is stored in clear, so this command can never print a usable
token. With no tokens yet: `No MCP tokens yet. Create one: routerly mcp token create <name>`.

#### `routerly mcp token create`

```
routerly mcp token create <name> [--expires <date>] [--json]
```

| Option | Description |
|--------|-------------|
| `--expires <date>` | Expiry date, e.g. `2027-01-01`. Omit for a token that never expires |
| `--json` | Output the created token as raw JSON |

```bash
routerly mcp token create laptop
```
```
✓ MCP token "laptop" created.

Token (save it now, it is shown only once):
sk-rt-mcp-8f3c1d...
  ID:      2f1c0b8a-...
```

The raw value is returned exactly once, here. Routerly stores only its
SHA-256 hash.

**Error cases:**
- `--expires` is not a parseable date: `Error: --expires must be a valid date, e.g. 2027-01-01.` (checked before the API call)
- The name is already used by one of your tokens: `Error: An MCP token named "<name>" already exists`

#### `routerly mcp token remove`

```
routerly mcp token remove <token-id>
```

```bash
routerly mcp token remove 2f1c0b8a-...
```
```
✓ MCP token revoked. Clients using it stop working immediately.
```

Unknown id: `MCP token "<id>" not found.`

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
| `--router <slug>` | Filter to one router |
| `--type <type>` | Filter by request type: `chat`, `completion`, `embedding`, `rerank`, `image`, `audio` |
| `--caller <caller>` | Filter by who made the call: `routing`, `completion`, `guardrail`, `judge` |
| `--session-id <id>` | Filter by session ID |
| `--end-user <id>` | Filter by end-user ID |
| `--token <id>` | Filter by router token ID, comma-separated for several |
| `--tag <key=value>` | Filter by tag |
| `--json` | JSON output |

The footer line below the model table shows a summary and a **callType breakdown**:

```
Total: $0.001234 USD (142 ok, 2 errors, 3 blocked)
Breakdown - completion: 142 calls / $0.001200  |  routing: 8 calls / $0.000011  |  guardrail: 12 calls / $0.000023  |  blocked: 3 calls
Types - Chat: 138  |  Embedding: 24
```

The summary suffix `, N blocked` appears when at least one request was blocked by a guardrail rule. Blocked requests contribute zero cost. The breakdown line includes a `blocked: N calls` entry for the same count.

The **Types** line lists the request types the window actually holds, busiest first: it says which values of `--type` are worth passing. It counts the window before `--type` and `--caller` narrow it, so it stays the same when either flag is set.

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
| `--router <slug>` | Filter to one router |
| `--type <type>` | Filter by request type: `chat`, `completion`, `embedding`, `rerank`, `image`, `audio` |
| `--caller <caller>` | Filter by who made the call: `routing`, `completion`, `guardrail`, `judge` |
| `--token <id>` | Filter by router token ID, comma-separated for several |

The table has a **Type** column showing what each call asked for and a **Caller** column showing who made it: `completion` for what a client asked for, `routing` for the router's own decision calls, `guardrail` for security-rule calls, `judge` for experiment judges. Records written before 0.4.0 carry neither field and are shown as `Chat` / `completion`, which is what the gateway tracked at the time.

The **Token** column shows the head of the router token the call came in on, the one identifier that separates two clients of the same router. It reads `-` on records written before 0.4.0 and on calls the gateway made on its own behalf. Pass the full token ID to `--token` to keep only that client's traffic.

```
routerly report calls --type embedding --limit 10
routerly report calls --caller routing --limit 10
routerly report calls --token 3f2b1c4d-9a8b-4c7d-8e6f-1a2b3c4d5e6f
```

An unknown `--type` or `--caller` value exits 1 with the list of accepted values, rather than returning an empty report.

### `routerly report savings`

What the routing, the prompt cache and the optimizers saved over a period.

```
routerly report savings [options]
```

| Option | Description |
|--------|-------------|
| `--period <period>` | `daily`, `weekly`, `monthly`, `all` (default: `monthly`) |
| `--router <id>` | Filter by router ID |
| `--type <type>` | Filter by request type: `chat`, `completion`, `embedding`, `rerank`, `image`, `audio` |
| `--trend` | Add a per-bucket breakdown: one row per hour with `--period daily`, one per day otherwise |
| `--json` | Output the raw savings block |

The command reads `GET /api/usage?savings=1` (see [API: Usage](../api/management.md#usage)) and needs the same `report:read` permission as the rest of `report`. With `--router`, the counterfactual is computed against that router's **enabled target models**, so the flag narrows both the traffic and the models it is compared against. Without it, the comparison covers the paid models **in play** in the period: the enabled target models of the routers that produced traffic, plus the models that actually served a client call. Embedding models are never baselines, since they cannot answer a completion call.

```
routerly report savings --router my-api --period weekly
```

```
Savings Report — WEEKLY

Compared calls: 187
Actual cost:    $0.114500
Tokens:         1,204,880 in / 96,410 out
Prompt cache:   402,110 tokens served from cache, $0.030800 saved

If everything had gone to one model
┌─────────────────┬────────────┬────────────┬─────────┬────────────┬────────────┬──────────────┐
│ Model           │ Would cost │ Saved      │ Saved % │ Would take │ Time saved │ Tokens saved │
├─────────────────┼────────────┼────────────┼─────────┼────────────┼────────────┼──────────────┤
│ gpt-4o          │ $0.412900  │ $0.298400  │ 72.3%   │ 18,420 ms  │ 6,180 ms   │ 0            │
├─────────────────┼────────────┼────────────┼─────────┼────────────┼────────────┼──────────────┤
│ claude-sonnet-4 │ $0.238100  │ $0.123600  │ 51.9%   │ no sample  │ -          │ 195,193      │
├─────────────────┼────────────┼────────────┼─────────┼────────────┼────────────┼──────────────┤
│ qwen3:4b        │ $0.061200  │ -$0.053300 │ -46.6%  │ 31,900 ms  │ -19,300 ms │ 130,129      │
└─────────────────┴────────────┴────────────┴─────────┴────────────┴────────────┴──────────────┘
Cost saved:   $0.298400 (vs always openai/gpt-4o)
              -$0.053300 (vs always ollama/qwen3:4b)
Time saved:   6,180 ms (vs always openai/gpt-4o)
Tokens saved: 148,665 cut by optimizers, measured
              0 vs always openai/gpt-4o, estimated

What the optimizers removed
┌───────────────┬────────────────────────────────┬───────────────┬──────────────┬────────────┬─────────────┐
│ ID            │ Name                           │ Calls changed │ Tokens saved │ Cost saved │ Rolled back │
├───────────────┼────────────────────────────────┼───────────────┼──────────────┼────────────┼─────────────┤
│ session-dedup │ Session Dedup                  │ 91            │ 18,442       │ $0.014120  │ 0           │
├───────────────┼────────────────────────────────┼───────────────┼──────────────┼────────────┼─────────────┤
│ ccr           │ Conversation Context Reduction │ 74            │ 126,905      │ $0.097180  │ 0           │
├───────────────┼────────────────────────────────┼───────────────┼──────────────┼────────────┼─────────────┤
│ caveman       │ Caveman                        │ 12            │ 3,318        │ $0.002540  │ 5           │
└───────────────┴────────────────────────────────┴───────────────┴──────────────┴────────────┴─────────────┘

Costs are the observed tokens repriced, times are estimated from each model's own throughput in the period.
```

Reading the two tables:

- **If everything had gone to one model** is a counterfactual, one row per enabled target model. `Saved` is positive when the routing came out cheaper than sending everything to that model and negative (red) when it did not, which is the expected shape for a cheap local model. `Would take` reads `no sample` when that model produced no output tokens in the period, so there is no throughput to estimate from, and `Time saved` then shows `-`. `Tokens saved` is an estimate from the ratio between tokenizer families, not a re-tokenization: Routerly does not retain prompts.
- The lines under the table are the **summary**, the same figures the dashboard [Overview](../dashboard/overview.md#the-saving-cards) shows as cards. Each one is anchored on the costliest paid baseline, the worst case routing avoided, and names it. The second cost line repeats the comparison against the cheapest paid baseline, which is usually negative: sending everything to the cheapest model always costs less than routing, and costs quality. Free models are left out entirely: a saving measured against a local model that costs nothing says nothing about what routing avoided paying. Token savings are kept apart on purpose, what the optimizers really removed against what a different tokenizer would have counted.
- **What the optimizers removed** is measured on the calls as they were served, not repriced. It is printed only when at least one optimizer changed a call in the period, and stays empty for records written before 0.4.0, which carry no per-optimizer numbers. A non-zero `Rolled back` count is highlighted: those results were rejected by the safety gate, which means that optimizer's threshold is too aggressive for this traffic. Tune it with [`routerly optimizers config`](#routerly-optimizers-config).

When nothing in the window can be compared, the command prints `No comparable calls for period: <period>` instead of a table of zeros. When the traffic belongs to routers with no enabled target model, the headline still prints and the counterfactual is replaced by `No target model to compare against.`

### Breaking the saving down over time

`--trend` adds a table under the two above, showing how the gap between the routed traffic and the counterfactual moved over the period. It reads `GET /api/usage?series=1` (see [API: Savings series](../api/management.md#savings-series)).

```
routerly report savings --period weekly --trend
```

```
Per day, against openai/gpt-4o
┌────────────┬───────┬───────────┬────────────┬───────────┬─────────────────┬────────┬────────────┐
│ Bucket     │ Calls │ Cost      │ Would cost │ Saved     │ Tokens in/out   │ Avg ms │ Would take │
├────────────┼───────┼───────────┼────────────┼───────────┼─────────────────┼────────┼────────────┤
│ 2026-07-27 │ 42    │ $0.024100 │ $0.092400  │ $0.068300 │ 260,410 / 21,880│ 1,204  │ 1,602      │
├────────────┼───────┼───────────┼────────────┼───────────┼─────────────────┼────────┼────────────┤
│ 2026-07-28 │ 61    │ $0.038200 │ $0.141900  │ $0.103700 │ 402,110 / 33,240│ 1,318  │ 1,744      │
└────────────┴───────┴───────────┴────────────┴───────────┴─────────────────┴────────┴────────────┘
```

The counterfactual columns are priced against the costliest target model in the window, the worst case the routing avoided, which is the same figure the dashboard [Overview](../dashboard/overview.md#what-routing-saved) shows. `Avg ms` and `Would take` are per call, not totals. Buckets with no comparable call are left out rather than printed as zeros, and only the most recent 60 buckets are shown.

`--json` prints the savings block on its own (`null` when the period is empty), which is the shape documented under [API: Usage](../api/management.md#usage):

```bash
routerly report savings --json | jq '.optimizers[] | select(.rolledBack > 0)'
```

With `--trend`, the series is added next to the savings fields rather than replacing them, so a script reading the block keeps working:

```bash
routerly report savings --json --trend | jq '.series.points[] | {bucket, saved: (.baselineCost - .cost)}'
```

---

## `routerly service`

### `routerly service status`

```
routerly service status [--json]
```

Same as `routerly status`. The output ends with one `Listening at:` line per address the service is reachable at (every IPv4 interface when bound to `0.0.0.0`, the single bind address otherwise).

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
| `--metrics <bool>` | Enable/disable the Prometheus `/metrics` endpoint |
| `--metrics-token <token>` | Bearer token protecting `/metrics` (empty string removes it) |
| `--public-url <url>` | External URL of the service |
| `--require-mfa <bool>` | Require two-factor authentication for all users |

Per-request timeouts are configured per router with `routerly router edit --timeout <ms>`, not service-wide.

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
#   Channel: current   Checked: 6/9/2026, 10:00:00 AM

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
| `latest` | Newest production-ready release |
| `current` | Newest production-ready release (same as `latest`) |
| `next` | Unstable/rolling release line |
| `vX.Y.Z` | Pin to a specific version tag (e.g. `v0.2.0`) |

`stable` and `develop` are still accepted as deprecated aliases for `current` and `next`, respectively. Removal is planned no earlier than the release after next.

```bash
routerly update channel           # show current channel
routerly update channel latest    # switch to latest
routerly update channel current   # switch to current
routerly update channel next      # switch to next (unstable/rolling)
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

This includes `system.update_available`, raised when the update checker finds a release newer than the one running on the configured channel. No CLI code is specific to this event: `routerly notification list` and `routerly notification show` render any event through the shared catalog, so it already appears with its readable title, "A newer release is available", the moment the check raises it.

### `routerly notification list`

```
routerly notification list [--json] [--severity <level>] [--category <name>]
                           [--event <slug>] [--unread] [--from <date>] [--to <date>]
```

List the 50 most recent inbox notifications. Results are newest-first. Each row shows the severity, the category, the human title with the event name underneath, and the cause built from the event details.

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON array |
| `--severity <level>` | Only items of this severity: `info`, `warning`, `critical` |
| `--category <name>` | Only items of this category: `routing`, `provider`, `budget`, `config`, `security`, `system` |
| `--event <slug>` | Only items whose event name contains this text |
| `--unread` | Only unread items |
| `--from <date>` | Only items on or after this date (YYYY-MM-DD or ISO 8601) |
| `--to <date>` | Only items on or before this date (YYYY-MM-DD or ISO 8601) |

```bash
routerly notification list
routerly notification list --category provider --severity critical
routerly notification list --event budget --unread
routerly notification list --from 2026-06-01 --to 2026-06-30
routerly notification list --json
```

An unknown `--category` is rejected before any request is sent, with the valid values listed on stderr and exit code 1.

### `routerly notification show <id>`

```
routerly notification show <id> [--json]
```

Show a single notification: title, event name, category, severity, read status, timestamp, the cause, the trace id when the item belongs to a correlated incident, and the full `details` object. Secrets are masked.

When several events share the same trace, the command also prints **Events in this incident** listing the whole sequence in the order it happened.

```bash
routerly notification show 8f3c…
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

### `routerly notification archive [ids...]`

```
routerly notification archive [<id> ...] [--all] [--json]
```

Archive one or more notifications from your inbox. Archiving is per-user only; other users' copies remain. `routerly notification delete` is kept as an alias of this command.

| Option | Description |
|--------|-------------|
| `<id> ...` | One or more notification IDs to archive |
| `--all` | Archive all notifications in your inbox |
| `--json` | Output the archived count as JSON |

```bash
routerly notification archive 8f3c…
routerly notification archive 8f3c… 1a2b… 3c4d…
routerly notification archive --all
routerly notification archive --all --json
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

