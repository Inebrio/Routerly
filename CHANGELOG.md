# Changelog

All notable changes to Routerly are documented in this file.

---

## [0.4.0] — 2026-07-28

### Internal

**Modular kernel architecture**
The service core has been reorganized from inline route handlers into a dependency-injection container with a modular, phase-based pipeline. This enables extensibility without touching core code: new security rules, routing policies, or provider adapters are registered as independently testable modules contributing processors to a shared pipeline. The refactor preserves wire-format transparency absolutely — all request and response payloads are byte-for-byte identical to previous versions. The architecture is: a frozen `ServiceContainer` housing DI tokens; a `ProcessorRegistry` that chains `Processor<ProxyContext>` objects across a frozen, ordered phase list (ingress, protocol.decode, request.preprocess, routing.prepare, routing.execute, upstream.prepare, upstream.execute, response.postprocess, protocol.encode, egress, finalize); bootstrap assembly in `modules/` where each subsystem (auth, routing, guardrails, budget, usage, logging, pii, notifications, observability, reverse-proxy, and others) registers its own processors behind a module token; and an atomic phase-scoped runner that executes the pipeline while honouring short-circuit guards (block, error, early-exit). Concerns are now decoupled: the guardrail module no longer knows about PII scrubbing, the routing engine no longer duplicates budget checks, and the reverse-proxy lanes (openai, anthropic) are isolated transport processors that delegate all policy logic to the phase pipeline. The routes layer (`modules/api-reverse-proxy/`) delegates to `runProxy(pipeline)` without inline handler logic. This is a major internal refactor with no new user-facing features from the restructuring itself, but it enables future work on composability and operator-written extensions.

### Fixes

**Guardrail steering injection regression**
When the modular pipeline was activated (atomic route flip from inline handlers to runproxy), the request-injection merge logic that applies inject-only guardrail instructions to the outgoing request system prompt was deleted without being reimplemented in the new pipeline. This caused content guardrails configured with `inject: true` but without a block/log `target` (inject-only steering rules) to silently drop their steering instructions and have no effect on the model. The regression affected topic and moderation rules used only for soft steering, not blocking or logging. The fix adds dedicated upstream.prepare-phase processors `openai:inject` and `anthropic:inject` that merge steering instructions from the guardrail module into the correct system-message field for each provider, matching the previous behavior exactly. Inject-only guardrails (topic and moderation rules with no request/response/both target) are now restored and functional.

### Breaking changes

None. The OpenAI and Anthropic wire formats are unchanged.

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
