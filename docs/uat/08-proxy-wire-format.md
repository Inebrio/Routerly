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
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-01/sdk.txt (openai SDK 4.104 baseURL+key only; key sets and usage shape identical to direct; model gpt-4.1-nano-2025-04-14, usage 9/2/11)

### UAT-08-02 - OpenAI streaming
**Surfaces:** service
**Preconditions:** As above
**Steps:**
1. Same call with `stream: true`.
**Expected:** SSE chunks and the final `[DONE]` match the provider's format; no extra events.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-02/raw-streams.txt (chunk key sets, finish, usage chunk and [DONE] identical to direct; minor: content-type lacks "; charset=utf-8")

### UAT-08-03 - Anthropic SDK messages
**Surfaces:** service
**Preconditions:** Router token, Anthropic SDK
**Steps:**
1. Point `baseURL` at the Routerly host and call `messages.create`, plain and streaming.
**Expected:** Works unchanged; event types and ordering match the provider.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-01/sdk.txt + tmp/evidence/UAT-08-02/raw-streams.txt (anthropic SDK 0.39 plain and stream; event order identical, model claude-haiku-4-5-20251001, usage 9/14)

### UAT-08-04 - Anthropic count_tokens
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. `POST /v1/messages/count_tokens`.
**Expected:** Returns the provider's `input_tokens` shape.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-05/models-count.txt (shape {"input_tokens":N} ok; note value 2 vs provider 9 for same body: Routerly estimates locally)

### UAT-08-05 - Models listing
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. `GET /v1/models` and `GET /v1/models/:model`.
**Expected:** OpenAI-shaped list and object; unknown model returns a provider-shaped 404.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-05/models-count.txt, tmp/evidence/UAT-08-09/errors.txt (GET /v1/models/openai/gpt-4.1-nano unencoded, as the OpenAI SDK sends it, gives bare Fastify 404; unknown id 404 is {error:{type:"not_found"}} with no code/param; list adds pseudo model routerly/ada and created=now)

### UAT-08-06 - No Routerly headers on responses
**Surfaces:** service
**Preconditions:** Any successful request
**Steps:**
1. Capture all response headers (`curl -D -`).
**Expected:** No `x-routerly-*` header, no header added, removed or renamed relative to the provider's response.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-06/headers.txt, tmp/evidence/UAT-08-02/raw-streams.txt (no x-routerly-* header, but OpenAI lane drops all provider headers incl. x-request-id/openai-*/x-ratelimit-* and adds vary: Origin; Anthropic lane forwards them all, incl. anthropic-organization-id)

### UAT-08-07 - Request payload forwarded unmodified
**Surfaces:** service
**Preconditions:** Real provider; a recording proxy between Routerly and the provider (or provider-side request logs) is available
**Steps:**
1. Send a request with unusual but valid fields (`user`, `metadata`, `tools`, `response_format`).
**Expected:** Every client field reaches the provider unchanged; no field is added.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-07/rec-run3.txt (OpenAI lane: max_tokens rewritten to max_completion_tokens, "stream":false added, body re-serialised; Anthropic lane byte-identical apart from model prefix)

### UAT-08-08 - Client request headers
**Surfaces:** service
**Preconditions:** Request carrying `User-Agent`, `anthropic-version`, `anthropic-beta`, `openai-organization`
**Steps:**
1. Send through Routerly and compare the headers the provider receives with a direct call.
**Expected:** Provider-relevant headers are forwarded unchanged.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-07/rec-run3.txt (OpenAI lane: client User-Agent replaced by OpenAI/JS + x-stainless-*, openai-organization and custom headers dropped; Anthropic lane forwards user-agent, anthropic-version, anthropic-beta, custom headers)

### UAT-08-09 - Provider-shaped errors
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. Send a malformed body, an unknown model, a revoked token and an over-limit request.
**Expected:** Each error body has the provider shape (`error.message`, `error.type`) with the right HTTP status, never a bare string.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-09/errors.txt (malformed JSON and missing/invalid auth give bare/string error bodies, no error.type; provider 400 on OpenAI lane becomes 503 server_error; revoked token -> 401 {"error":"unauthorized"} string; unknown model not rejected, router picks; over-limit already recorded)

### UAT-08-10 - Trace channel does not leak
**Surfaces:** service
**Preconditions:** Router token
**Steps:**
1. Send a request with and without the `x-routerly-trace` request header; inspect the response stream and headers.
**Expected:** The response is identical in both cases; no trace data appears in it.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/UAT-08-10/trace.txt (x-routerly-trace absent/1/true: same header names and body shape on both lanes, stream and non-stream, no trace data)
