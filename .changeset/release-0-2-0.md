---
"@routerly/service": minor
"@routerly/dashboard": minor
"@routerly/cli": minor
"@routerly/shared": minor
---

## Routerly 0.2.0

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

**Decoupled model IDs**
The Routerly model ID is now independent of the upstream provider API model name. This enables cleaner aliases and model renaming without breaking existing configurations.

**Built-in update checker**
Routerly now polls GitHub Releases every 24 hours and compares the running version against the configured channel (`latest`, `current`, `develop`, or a pinned tag). The result is cached in memory and surfaced via the dashboard and CLI.

**CLI update commands**
Three new subcommands under `routerly update`:
- `routerly update check` — show whether a newer version is available on the active channel
- `routerly update channel [name]` — get or set the update channel
- `routerly update run` — download and install the latest version (non-Docker only)

**Software Update section in the dashboard**
The Settings → About tab now shows the current channel, the latest available version, the last-checked timestamp, and a one-click update button. The channel selector is populated dynamically from GitHub Releases and always includes the base channels.

**New management API endpoints**
- `GET /api/system/update-check` — trigger an immediate update check and return the result
- `POST /api/system/update` — run the in-app updater (admin only; disabled in Docker)
- `GET /api/system/releases` — list available channels and version tags from GitHub Releases

**Improved dashboard UX**
- Policy editor: add/remove policies with a searchable select
- Usage page: time-based filtering and pagination
- Models are sorted alphabetically in all selectors

### Bug fixes and maintenance

- Fixed Qwen3 thinking-only response handling in the Ollama adapter
- Fixed `reasoning_effort` being forwarded to non-o-series OpenAI models
- Fixed FastAPI v5 `decorateRequest` compatibility
- Upgraded Fastify v5, Vite v6, Vitest v3, Commander v14, Zod v4, lucide-react
- Hardened supply-chain security (pinned action hashes, `npm audit --audit-level=high`)

### Breaking changes

None. The OpenAI and Anthropic wire formats are unchanged.
