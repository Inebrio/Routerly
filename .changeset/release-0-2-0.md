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
