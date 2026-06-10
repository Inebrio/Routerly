# Changelog

All notable changes to Routerly are documented in this file.

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
