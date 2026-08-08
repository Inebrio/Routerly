# Changelog

All notable changes to Routerly are documented in this file. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Every feature or bug fix lands an entry under **[Unreleased]** as part of
the change itself — never reconstructed after the fact. See
`CLAUDE.md`'s Changelog section.

---

## [Unreleased]

### New features

**Router, Orchestrator, and Passthrough kinds**
Projects are now Routers throughout the management API, CLI, dashboard, configuration, and usage records. A Router can be a standard model router, an Orchestrator that selects among candidate Routers, ordered by priority, with optional per-candidate limits, or a Passthrough Router that forwards requests unchanged with the client's upstream credential.

**Dashboard localization (41 languages)**
The dashboard now ships with 41 language catalogs (English plus 40 more, including Arabic, Hebrew, and Urdu with RTL layout), selectable per-account from a quick-access selector in the sidebar or from Profile → Preferences, and persisted server-side. Administrators can set an instance-wide default language (Settings → General → Internationalization, `defaultLanguage` in the management API, `routerly service configure --default-language`) used for any user who hasn't picked their own yet — the resolution order is personal choice, then browser locale, then the instance default, then English. Every visible label, button, and message across pages and shared components routes through the i18n catalog; CLI and service output remain English-only.

**Routers list grouped by kind**
The Routers list now has tabs (Router / Orchestrator / Passthrough) filtering by `RouterKind`. There is no "All" tab — an aggregate view added no filtering value once every router already belongs to exactly one kind.

**Dedicated creation form per router kind**
Creating a Router, Orchestrator, or Passthrough no longer goes through one shared form with a kind dropdown. Each non-"All" tab on the Routers list has its own "New <Kind>" button that opens a form dedicated to that kind — the kind is fixed by which button was clicked, never chosen from a selector. Editing an existing router's General tab shows its kind as a fixed, read-only label; `kind` is never sent on save. Orchestrator creation stays two steps: create with name and timeout, then add candidate routers on the Orchestrator tab.

**`performance` and `budget-remaining` as Orchestrator routing policies**
Orchestrators can now use the `performance` and `budget-remaining` policies alongside `health`/`rate-limit`/`fairness`, scored against candidate Routers instead of models. The shared decay/ratio scoring math these five policies and their Router-side equivalents both need was extracted into one internal module reused by both scoring paths — an internal refactor with no behavior change for existing policies.

**Drag-to-reorder Orchestrator candidates**
Orchestrator candidate Routers are now reordered by drag-and-drop instead of a numeric weight input; the candidate picker no longer shows the router's raw ID.

**Real target models alongside a Passthrough router's pass-through entry**
A Passthrough router's model list can now hold real target models alongside its fixed, non-deletable pass-through entry, in one ordered array — the pass-through entry is inserted automatically on creation and cannot be removed or duplicated, but real models can be added, removed, and reordered around it from the dashboard (`RouterRoutingTab`), the CLI (`router model add`/`remove`/`set-prompt`/new `router model reorder`), and the management API. Existing Passthrough routers are migrated automatically on first start to gain the pass-through entry. Execution wiring — actually routing to those real models — ships in a follow-up; this change is the config/CLI/dashboard surface only.

**Execution wiring for a Passthrough router's real target models** (follow-up to the above)
A Passthrough router's real target models now route, authenticate, and meter exactly like a normal router: same policy scoring, same budget/limit enforcement, same usage tracking. A Routerly bearer token is issued the moment the router has its first real model configured and revoked the moment the last one is removed; the pass-through entry itself keeps its existing unauthenticated, budget-exempt raw-forward behavior. The pass-through entry's position in the model list decides the router's default outcome: at index 0 (ahead of every real model), raw-forward always wins and real models are never scored; anywhere else, real models are scored and routed normally and the pass-through entry is used only as a last-resort fallback when none of them are eligible. On that fallback, Routerly forwards the client's own request headers unchanged rather than substituting a provider credential, so a client authenticating only with its Routerly token should expect the upstream provider to reject the fallback request with its own `401` unless it also sends a valid upstream credential.

### Bug fixes

- Secret config files (`models.json`, `connections.json`, `routers.json`, `users.json`) no longer revert to unsafe file permissions on every write — `writeConfig()` now preserves the `0600` mode instead of recreating the file at the umask default, which previously re-tripped the startup permission guard on the very next write after a fix.
- The same permission reversion could still happen through `updateConfig()` (the read-modify-write path most router/model CRUD routes use, including every add/remove/reorder on a router's model list) — `writeConfig()` was fixed but `updateConfig()` never got the matching fix, so a secret-tier file could regress to `0644` on the very next router edit. `updateConfig()` now applies the same `0600`-for-secrets / preserve-existing-mode logic `writeConfig()` uses.
- Usage records no longer cause unbounded `usage.json` growth or an OOM kill under sustained traffic (#124) — usage is now appended to `usage.ndjson`, an append-only log with a retention sweep, instead of being rewritten in full on every request.
- Dashboard: fixing unsafe config file permissions (from the blocking modal or from Settings → Security) now refreshes every permission-related UI on the page immediately — the top banner, the blocking modal, and the Settings section previously each polled independently and stayed stale until a manual reload.
- Orchestrators now honor their own `health`/`rate-limit`/`fairness` routing policies (including `enabled: false` and custom windows) when scoring candidate routers, instead of always applying hardcoded defaults regardless of what was saved.
- Creating or updating an Orchestrator now rejects (HTTP 400) any policy type outside the Orchestrator-compatible set (`health`, `rate-limit`, `fairness`, `performance`, `budget-remaining` — the ones that score a candidate Router as a whole). The other types (`cheapest`, `capability`, `context`, `llm`, `semantic-intent`, `model-preference`) pick among a pool of models, which an Orchestrator has none of; previously they were silently accepted and had no effect.
- Dashboard: the Orchestrator's Routing tab now has a Routing Policies section (same layout as a plain Router's Routing tab, with the candidate-router list in place of target models), offering the Orchestrator-compatible policy types — the ones an Orchestrator could never configure before.
- Passthrough routers no longer take a manual slug/path field. The `/passthrough/<slug>/...` path segment is now derived automatically from the router's name (disambiguated with a numeric suffix on collision), removing a step that duplicated the name and could conflict silently. `router create`/`router edit` drop `--slug`; the management API drops `slug` from the request body (still present, read-only, in the response).
- Passthrough router names are now unique only among other Passthroughs, not across every router kind — a Passthrough can share its name with an existing Router or Orchestrator (it is reached by slug, never by name), while Router and Orchestrator names stay unique among themselves as before.
- Dashboard: creating a Passthrough router now redirects straight to its General tab, instead of surfacing a spurious "Unsaved Changes" confirmation on the create form's own success redirect.

### Breaking changes

- The management surface uses `router` and `routers` instead of `project` and `projects`. API paths, CLI commands, dashboard routes, configuration fields, and usage fields have no backward aliases. Existing `projects.json` data migrates to `routers.json` automatically and idempotently on first start.
- `router create --candidate`/`router edit --candidate` no longer accepts `<routerId>:<weight>` — use `--candidate <routerId>` (repeatable); order of repetition is now the priority order. The old syntax is rejected with an error naming the replacement, not silently reinterpreted.

---

## [0.4.0] — 2026-08-06

### New features

**Content guardrails and PII scrubbing**
A guardrail layer intercepts every request and response. Rules can block or log based on keyword, regex, or semantic judge scoring, and can inject a soft steering instruction into the system prompt. PII scrubbing runs before guardrails on the request side, so the judge never sees raw PII. Judge rules score on a 0–10 anchored rubric with a reason-first response, evaluated against the full conversation history so a rephrased or softened follow-up is still caught. Guardrail and PII events appear as dedicated trace entries; blocked requests are counted separately in usage reports.

**Notification system**
Notification channels (Slack, Teams, PagerDuty, Discord, email, in-app) can be scoped to specific projects and events, with per-channel routing rules and cooldowns. An in-app inbox in the dashboard groups events from the same trace into one incident and shows a user only the items their role can reach. Budget events and update-available events both trigger notifications. Full CLI support via `routerly notifications channels` and `routerly notifications inbox`.

**2FA / TOTP**
Users enroll a TOTP authenticator from the dashboard, with a scannable QR code during setup. Login enforces 2FA when enabled. Admins can require 2FA for all users from Settings and reset any user's enrollment from the Users list.

**Prompt playground**
A dashboard playground supports single and compare modes, with compare mode running the same prompt against two models in parallel with per-panel parameters and debug traces. A preset library is included; each turn renders as its own card, newest first.

**Dynamic model catalog**
The model and provider catalog loads at runtime from configurable git repositories (default: the official Inebrio catalog), resolved by channel, semver range, or fallback, and cached 6 hours with checksum verification. The dashboard's Model Discovery page lists available models with provider and capability filters; `routerly models discover` and `routerly catalog refresh` cover the CLI side.

**Enterprise and native providers**
Native adapters for AWS Bedrock (Converse Stream binary parser), Azure OpenAI, and Google Vertex AI, alongside `openai-web`/`anthropic-web` browser-session adapters and `anthropic-oauth`/`openai-oauth` subscription adapters for users with an active Claude/ChatGPT subscription. All follow the same wire-format transparency rules as the built-in providers, and connection credentials are handled with provider-aware parity across the service, CLI, and dashboard.

**Connections and model instances**
Provider configuration is split into two concerns: a **connection** (credentials and endpoint, created once) and a **model instance** (a model bound to a connection, with its own pricing and capability overrides). Existing `models.json` entries migrate to this shape automatically and idempotently on first start. The dashboard gets dedicated connection create/edit pages and a filtered model list per connection; the CLI adds `routerly connections list|add|remove`, with credentials always stripped from `--json` output.

**Client integrations and the Connect page**
A client registry with guided setup for Claude Code, Codex, OpenCode, Cline, Continue, Cursor, and any other OpenAI/Anthropic-SDK client. The dashboard's Connect section groups clients by brand with connect-mode badges and MCP snippets where relevant. `routerly clients list|inspect|configure|doctor|undo|launch` writes and repairs a client's local config file directly from the CLI, backed by an atomic backup-and-checksum file-transaction helper; `configure` mints a project token unless `--token` is passed.

**Routing profiles (routing, optimizer, security)**
Profiles generalize routing configuration into three kinds — routing, optimizer, and security — each assignable to a project independently, with built-in presets, cloning, a from-scratch creation flow, and a simulate/preview endpoint. Selector strategies (`argmax`, `weighted-random`, `round-robin`, `cheapest`, `lowest-latency`) and fallback strategies (`next-best`, `retry-after-cooldown`, `abort`) are pluggable per profile. `routerly profiles list|show|clone|set` and a project-level profile-vs-custom switch cover the CLI and dashboard.

**Resilience (circuit breaker)**
A 3-level in-memory resilience store (model, connection, provider) classifies upstream faults, including TTFT timeouts, and acts as a hard pre-filter on routing so a degraded upstream is skipped automatically. `routerly resilience status|reset` and `GET/POST /api/resilience` expose the state; the dashboard surfaces it inline on the project's routing tab rather than as a separate page.

**Optimizers**
Eight built-in, per-project, opt-in optimizers reduce a request's token footprint before it reaches the provider: `session-dedup` (exact-match dedup, lossless), `ccr` (conversation context reduction, recoverable), `rtk` (redundant token killer, recoverable), `headroom` (context-window trimming, lossless), `relevance` (semantic near-duplicate removal, lossy, opt-in), `llmlingua-2` (ONNX-backed compression with an installable checkpoint, lossy, off by default), and `caveman` (English-only lexical compression, lossy). Every `lossy` result passes a shared safety gate before being accepted; `recoverable` steps roll back on a failed validation. The dashboard's per-project optimizer tab previews each step against real traffic samples and explains why a step did or didn't fire; `routerly optimizers list|config|preview` covers the CLI.

**MCP server**
Routerly's own management API is exposed as MCP tools over two transports: streamable HTTP at `POST /mcp` and a local `routerly mcp serve` stdio wrapper. Authentication moved from project-token scopes to a personal MCP token (`sk-rt-mcp-…`, prefix distinct from project tokens) that carries every permission of its owner's role; six read tools and two gated write tools (`create_project_token`, `toggle_model`) are scope-filtered per token. The dashboard adds a tool-browser page and a dedicated token page on the user's profile; `routerly mcp tools|test|serve` and `routerly mcp token` cover the CLI.

**Experiments**
An experiment sits above projects as an A/B test: a client points at the experiment's own token, and each request is routed to one of the experiment's variants, each variant an existing project taken whole. Rotation is `sticky` (default, session-stable), `weighted`, or `round-robin`; a judge model scores each variant. Nothing about variant selection reaches the wire. The dashboard adds an experiments section with metrics and a shared date-range picker; the CLI adds a `routerly experiments` command group.

**Trace, usage, and savings**
The request trace is now an event-driven module with a live SSE channel and export, tracing every stage of a request on two levels (summary and full log) and storing the whole trace on the usage record. The usage table adds a readable call log with caller and request-type filters, and usage/overview pages add a savings and counterfactual layer: what routing actually saved against running the same traffic on a single fixed model, broken down per optimizer and shown over time on the overview page.

**Update notifications**
The service checks for newer releases and emits a deduplicated `system.update_available` notification event; the dashboard shows an update-available label and the CLI surfaces it too. Update channels are named `current` and `next` (deprecated aliases for the old names are still accepted).

**Provider-native prompt caching, TTFT timeout, and pass-through proxy**
Anthropic prompt caching headers are forwarded as-is, with cache read/write costs recorded per request. A configurable time-to-first-token timeout (default 2s, 0 disables it) is enforced per model attempt with fallback to the next provider on expiry. Unhandled provider endpoints, including `/v1/responses` and Anthropic tool calling, are forwarded transparently with no payload or header modification; clients can suppress SSE trace events with `x-routerly-no-trace: 1`.

**Dashboard-wide UX pass**
Every native `<select>` in the dashboard (provider, model, connection, and other dropdowns) is now a searchable select. The overview page was rebuilt around a single chart system, remembers the period picked, and adds a connect shortcut card; the sidebar nav was flattened and renamed after what each section holds; primary actions open by clicking a table row.

**Modular kernel architecture** (internal)
The service core has been reorganized from inline route handlers into a dependency-injection container with a modular, phase-based pipeline: a frozen `ServiceContainer` housing DI tokens, a `ProcessorRegistry` chaining `Processor<ProxyContext>` objects across a frozen, ordered phase list, and bootstrap assembly in `modules/` where each subsystem registers its own processors behind a module token. Preserves wire-format transparency absolutely. No new user-facing behavior from the restructuring itself, but every feature above is built on it.

### Bug fixes

- Fixed `updatedAt` in the model catalog always equalling `lastChecked` on first fetch, and the last repo in the list silently overriding earlier ones on a key conflict
- Fixed "Unrecognized keys: notificationRules, cooldowns" error when saving notification settings, and email provider parity with the dashboard
- Fixed Gemini adapter stripping the provider prefix from the model ID before the upstream call
- Fixed login redirect loop and double-encoded `to` parameter in the dashboard
- Fixed playground SSE buffering across chunk boundaries
- Fixed usage provider column resolution, null-cost guard in the usage page and CLI report, and blocked records leaking into the model leaderboard and routing health
- Fixed config writes to be atomic, widened the write-lock retry budget, and defaulted new config files to `0600` instead of `0644`
- Fixed p95 latency window (1h instead of 5m) and semantic-intent routing's embedding credentials lookup
- Fixed telemetry ping to be async with retry, and deduplicated install events
- Fixed notification channel SSRF hardening and permission enforcement, and dashboard 2FA QR UX / notification dropdown z-index
- Fixed custom providers to use raw fetch instead of the OpenAI SDK for wire-format transparency
- Fixed the model form not prefilling from discovery provider/model-ID params, and connection credentials leaking into model API responses
- Fixed OAuth: static bearer resolution for legacy migrated connections, refresh guarded against unknown expiry/malformed credentials, credentials encrypted on connection create/update, and a body-parse crash on token exchange
- Fixed resilience: connection breaker keyed on the real connection ID, partial level/id reset payloads rejected, an incorrect half-open recovery heuristic removed
- Fixed optimizers: `ccr` keeping Anthropic tool-use/tool-result pairs atomic, `caveman` no longer eating file paths and dotted identifiers, `headroom` actually firing, `llmlingua-2` scored in encoder windows instead of one throwing pass, threshold ranges made per-optimizer instead of a uniform 0–1, and a single shared token estimator used across all steps
- Fixed the MCP tool registry to drop a fabricated `enabled` field and gate tools on the owning module being enabled, so a disabled module removes its tool from the list
- Fixed npm audit high-severity advisories, including an authorization-bypass fix in the dashboard's static-file plugin (`@fastify/static` 9 → 10.1.2; verified no traversal shape escapes the dist root)
- Fixed searchable-select dropdowns to restore accessible naming and keyboard operation
- Fixed docs-versioning to track live `docs/` content instead of freezing an unstable snapshot ahead of its real release
- Fixed the guardrail steering-injection regression from the modular pipeline cutover: `inject: true` rules without a block/log target silently dropped their steering instruction; restored via dedicated `openai:inject`/`anthropic:inject` upstream.prepare processors

### Breaking changes

None on the wire. The OpenAI and Anthropic proxy formats (`/v1/*`, `/anthropic/*`) are unchanged: no header or payload added, removed, or renamed on request or response.

One breaking change on the management surface: **MCP authentication moved from project tokens to personal user tokens.** The `mcp` and `mcp:write` project-token scopes and the `mcp:read`/`mcp:manage` permissions no longer exist and are dropped from roles and tokens automatically on first start after the upgrade. A client still authenticating `/mcp` with a project token now gets `401` and must be re-pointed at a personal MCP token, created from the dashboard's Profile > MCP tab or `routerly mcp token`.

---

## [0.3.0] — 2026-07-13

### New features

**Content guardrails and PII scrubbing**
Per-project content guardrails inspect every request/response against configurable rules (keyword, regex, semantic judge). PII scrubbing strips sensitive entities before forwarding to the provider. Each rule carries an independent block or log action. Blocked requests are recorded in usage logs and visible in the dashboard with a guardrail trace.

**Hierarchical spend limits**
Budget limits can be set at org, team, and API-key level and cascade in priority order. Requests blocked by a budget gate are recorded in usage logs.

**Per-agent routing policies via request header**
Clients can override the project routing policy per-request using the `X-Routerly-Policy` header, enabling different routing strategies for different agents in the same project.

**Provider health dashboard**
A new Health tab inside the Models page shows real-time latency, error rates, and p95 metrics for every configured provider. The table is sortable, filterable, and paginated.

**Prometheus metrics endpoint**
`GET /metrics` exposes a Prometheus-compatible metrics stream. An optional bearer token can be required. Includes a Docker Compose integration example.

**Per-end-user and session tracking**
Usage records include end-user ID, session ID, and token-level key-value tags set at the project token level. A new End Users tab in the project detail page shows per-user consumption.

**Enterprise cloud providers**
New built-in adapters: AWS Bedrock (Converse/ConverseStream), Azure OpenAI, and Google Vertex AI.

**Web session providers**
`anthropic-web` and `openai-web` adapters relay requests through authenticated browser sessions. CLI supports `--cf-clearance` for Cloudflare-protected endpoints.

**Provider-native prompt caching**
Anthropic prompt caching headers are forwarded transparently. Cache read/write token counts appear in the per-request cost breakdown.

**2FA / TOTP enrollment**
Users can enroll a TOTP authenticator from their Profile page. Admins can require 2FA for all users. A reset-2FA action is available in the Users list.

**Model discovery**
A new Discovery page lets admins query any configured provider for its available models and add them directly to Routerly. The CLI command `routerly models discover` covers the same surface.

**Dynamic provider catalog**
Provider metadata (models, pricing, context windows) is loaded from one or more configurable git repositories. Multiple repos are merged in order; later repos override earlier entries on key conflict.

**Notification system**
Full notification stack: channels (in-app inbox, SMTP, Slack, Teams, PagerDuty, Discord), event routing rules with cooldowns, per-channel event and target scopes, and per-user dismiss for the in-app inbox.

**Prompt playground with compare mode**
An interactive playground lets users send prompts to any project model and inspect the full response, cost, and trace. Compare mode runs the same prompt against two models side by side.

**Metrics export integrations**
Push usage data to InfluxDB, Datadog, or any custom HTTP endpoint. Configured from Settings → Integrations.

**Transparent pass-through proxy**
Any request path not handled by the gateway is forwarded to the matched provider verbatim, preserving all headers and the response body. This enables full Claude Code compatibility without any client-side changes.

**Claude Code integration**
Routerly can be used as a drop-in proxy for Claude Code by setting `ANTHROPIC_BASE_URL` to the Routerly service URL. All Anthropic SDK methods, streaming, and tool-use calls work transparently.

### Bug fixes and maintenance

- Fixed config write lock retry budget for high-concurrency scenarios
- Fixed guardrail/blocked breakdown in CLI `report usage`
- Fixed dashboard: prevent login redirect loop and double-encoded `to` param
- Fixed notification dropdown z-index and 2FA UX improvements
- Fixed Gemini: strip provider prefix from model ID before upstream call
- Fixed routing fairness policy and added OAuth usage tracking
- Hardened SSRF protection on notification channel target resolution
- Improved catalog: use upstream content-change timestamp; last repo in list no longer silently overrides earlier ones on key conflict
- Fixed update checker: extract semver from release name for rolling channels

### Breaking changes

None. The OpenAI and Anthropic wire formats are unchanged.

---

## [0.2.0] — 2026-06-10

### New features

**Semantic response cache**
Responses are now cached by semantic similarity of the prompt. Repeated or semantically equivalent requests are served from cache, reducing cost and latency. Cache hits are tracked in usage logs and visible in the dashboard.

**Semantic intent routing**
A new routing policy matches incoming requests to models based on declared semantic intent. Projects can save routing feedback from the dashboard to improve intent matching over time.

**Anthropic Messages API**
Full support for the Anthropic `/v1/messages` endpoint with multi-provider fallback. Claude Desktop and other Anthropic-native clients can now use Routerly as a drop-in proxy.

**Conversation-aware routing memory**
The routing engine now maintains a short-term conversation memory store. Subsequent turns in the same conversation are routed to the same model, improving coherence in multi-turn sessions.

**Per-request cost breakdown**
Every request now records a detailed cost breakdown (input tokens, output tokens, cache read/write tokens) in usage logs. The dashboard displays this breakdown in the usage detail view.

**New model providers**
Added built-in support for: DeepSeek, Groq, Together AI, and Perplexity. Pricing and context-window data are included in the model catalog.

**New model catalog entries**
Added `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7` with correct pricing and context-window data.

**Decoupled model IDs**
The Routerly model ID is now independent of the upstream provider API model name. This enables cleaner aliases and model renaming without breaking existing configurations.

**Built-in update checker**
Routerly now polls GitHub Releases every 24 hours and compares the running version against the configured channel (`latest`, `current`, `develop`, or a pinned tag). The result is cached in memory and surfaced via the dashboard and CLI.

**Dynamic update channels**
Available update channels and release tags are loaded directly from GitHub Releases at runtime. The channel selector in the dashboard always shows the base channels plus any published release tags.

**CLI update commands**
Three new subcommands under `routerly update`:
- `routerly update check` — show whether a newer version is available on the active channel
- `routerly update channel [name]` — get or set the update channel
- `routerly update run` — download and install the latest version (non-Docker only)

**Software Update section in the dashboard**
The Settings → About tab now shows the current channel, the latest available version, the last-checked timestamp, and a one-click update button. The channel selector is populated dynamically from GitHub Releases and always includes the base channels.

**Opt-in anonymous telemetry**
Install metrics (event type, version, platform, anonymous install ID) can be enabled or disabled from the dashboard Settings or via `routerly telemetry enable/disable`. Disabled by default.

**Help & Support page**
New Help page in the dashboard with links to documentation, GitHub Issues, and email support, plus an FAQ section for common questions.

**New management API endpoints**
- `GET /api/system/info` — system info (version, channel, Docker flag, update status) — public, no auth required
- `GET /api/system/update-check` — trigger an immediate update check (admin auth required)
- `POST /api/system/update` — run the in-app updater (admin JWT required; disabled in Docker)
- `GET /api/system/releases` — list available channels and version tags from GitHub Releases

**Improved dashboard UX**
- Policy editor: add/remove policies with a searchable select
- Usage page: time-based filtering and pagination
- Models are sorted alphabetically in all selectors

### Bug fixes and maintenance

- Fixed `GET /api/system/info` being incorrectly protected by JWT middleware — it is now public
- Fixed Qwen3 thinking-only response handling in the Ollama adapter
- Fixed `reasoning_effort` being forwarded to non-o-series OpenAI models
- Fixed Fastify v5 `decorateRequest` compatibility
- Fixed missing `draft` field in GitHub Release interface
- Fixed update channel selector always showing base channels, removed version downgrade option
- Upgraded Fastify v5, Vite v6, Vitest v4, Commander v14, Zod v4, lucide-react
- Fixed Vitest 4.x compatibility (`loadEnv` import moved from `vitest/config` to `vite`)
- Hardened supply-chain security (pinned action hashes, `npm audit --audit-level=high`)
- Added unit tests for cost calculator (`calculateCost`)

### Breaking changes

None. The OpenAI and Anthropic wire formats are unchanged.

---

## [0.1.5] — 2026-03-27

See [GitHub Release](https://github.com/Inebrio/Routerly/releases/tag/v0.1.5).

---

## [0.1.4] and earlier

See the [GitHub Releases page](https://github.com/Inebrio/Routerly/releases).
