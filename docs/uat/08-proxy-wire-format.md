# 08 - Proxy wire format

Routerly must be a drop-in base-URL replacement. Compare each response and request with a direct provider call. No custom headers, no non-standard fields.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-08-01 - OpenAI SDK chat completion
**Surfaces:** service
**Preconditions:** Router token, OpenAI SDK installed
**Steps:**
1. Point the official SDK `baseURL` at `http://<host>:3000/v1` and call `chat.completions.create`.
**Expected:** Works with only the base URL and key changed; response parses with no unknown fields.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-02 - OpenAI streaming
**Surfaces:** service
**Preconditions:** As above
**Steps:**
1. Same call with `stream: true`.
**Expected:** SSE chunks and the final `[DONE]` match the provider's format; no extra events.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-03 - Anthropic SDK messages
**Surfaces:** service
**Preconditions:** Router token, Anthropic SDK
**Steps:**
1. Point `baseURL` at the Routerly host and call `messages.create`, plain and streaming.
**Expected:** Works unchanged; event types and ordering match the provider.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-04 - Anthropic count_tokens
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. `POST /v1/messages/count_tokens`.
**Expected:** Returns the provider's `input_tokens` shape.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-05 - Models listing
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. `GET /v1/models` and `GET /v1/models/:model`.
**Expected:** OpenAI-shaped list and object; unknown model returns a provider-shaped 404.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-06 - No Routerly headers on responses
**Surfaces:** service
**Preconditions:** Any successful request
**Steps:**
1. Capture all response headers (`curl -D -`).
**Expected:** No `x-routerly-*` header, no header added, removed or renamed relative to the provider's response.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-07 - Request payload forwarded unmodified
**Surfaces:** service
**Preconditions:** Real provider; a recording proxy between Routerly and the provider (or provider-side request logs) is available
**Steps:**
1. Send a request with unusual but valid fields (`user`, `metadata`, `tools`, `response_format`).
**Expected:** Every client field reaches the provider unchanged; no field is added.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-08 - Client request headers
**Surfaces:** service
**Preconditions:** Request carrying `User-Agent`, `anthropic-version`, `anthropic-beta`, `openai-organization`
**Steps:**
1. Send through Routerly and compare the headers the provider receives with a direct call.
**Expected:** Provider-relevant headers are forwarded unchanged.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-09 - Provider-shaped errors
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. Send a malformed body, an unknown model, a revoked token and an over-limit request.
**Expected:** Each error body has the provider shape (`error.message`, `error.type`) with the right HTTP status, never a bare string.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-08-10 - Trace channel does not leak
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. Send a request with and without the `x-routerly-trace` request header; inspect the response stream and headers.
**Expected:** The response is identical in both cases; no trace data appears in it.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
