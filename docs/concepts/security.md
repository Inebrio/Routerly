---
title: Security Policies
sidebar_position: 6
---

# Security Policies

Routerly supports two independent security systems: content guardrails and PII scrubbing. Both operate on a per-router basis and can be configured to evaluate requests, responses, or both directions.

---

## Content Guardrails

Guardrails evaluate messages against an ordered list of independent rules. Each rule has independent scope flags that control how it evaluates:
- **Request** / **Response**: run the judge on that side (hard block + log on trigger)
- **Inject**: append the rule instruction to the outgoing request system prompt so the serving model self-enforces (soft steer, no block, mutates payload)

Topic and moderation rules can combine these flags in any way; regex and semantic rules only support request/response (no inject). A rule must have at least one flag enabled.

For topic/moderation rules with a judge (request and/or response enabled), the block and log actions are automatic: all judged rules block and log on trigger. Rules with only inject enabled skip the judge entirely (soft steering only).

### Processing Order

On each request, security processing follows a strict order:

1. **Request side:** PII scrubbing (request policies) first, then guardrail rules (request/both target)
2. **Provider call:** Routed to the selected model
3. **Response side:** PII scrubbing (response policies) first, then guardrail rules (response/both target)

Critical: on the request side, PII is scrubbed BEFORE guardrails evaluate the message. This means the guardrail judge never sees raw PII data, only the scrubbed version.

### Rule Types

**Regex:** Match text against one or more regex patterns (case-insensitive). No external model required. Evaluates the last user message only.

**Semantic:** Use an embedding model to detect semantically similar content. Computes cosine similarity against provided examples and triggers if the score exceeds the threshold (default 0.82). Evaluates the last user message only. Supports optional fallback embedding models (tried in order if the primary fails).

**Topic:** Use an LLM judge model to evaluate whether content matches allowed topics. The judge receives the ENTIRE conversation history (all messages the final model will see) and scores the latest user request on a 0.00 to 10.00 anchored rubric (0.00 = completely off-topic, 5.00 = borderline, 10.00 = fully on-topic), read in the full context of the conversation rather than in isolation. This means a request that only looks disallowed given earlier turns (a rephrasing, softening, follow-up, insistence, or continuation of an earlier disallowed request) is caught. The score is normalized to 0-1 and triggers if it falls below the threshold (default 0.5, meaning off-topic). Supports optional fallback judge models.

**Moderation:** Use an LLM judge model to detect harmful content (hate, violence, sexual, self-harm). The judge receives the ENTIRE conversation history and scores the latest user request on a 0.00 to 10.00 anchored rubric (0.00 = completely safe, 5.00 = borderline, 10.00 = severely harmful), read in the full context of the conversation. A request that pursues disallowed content by rephrasing, softening, insisting on, or continuing an earlier refused request is judged on that intent, not on the isolated wording of the last message. The score is normalized to 0-1 and triggers if it exceeds the threshold (default 0.5). Supports optional fallback judge models.

### Judge Scoring and Block Messages

When a judge rule blocks, the judge model is asked to respond with a JSON object containing a reason FIRST, then a fine-grained score:

```json
{
  "reason": "<one short sentence explaining the rating>",
  "score": 5.50
}
```

The reason is written in the same language as the user's latest message and is returned to the client as the block message. The score (0.00-10.00) is normalized to 0-1 before the threshold check (making backward-compatible thresholds).

The reason-first rubric (with anchored scales for both topic and moderation) prevents bimodal score collapse that occurs when small models respond to holistic 0-1 scores at temperature 0. Judge models produce more nuanced and consistent results when asked to explain their reasoning before numbering it.

If the judge fails or returns no reason, a built-in default block message is used.

### Judge JSON Repair

When model-based guardrail rules (topic, moderation, semantic) invoke an LLM judge, the judge's response is expected to be JSON. If the response is malformed, Routerly attempts to repair it by:

1. Stripping code fences and preamble text
2. Extracting the first balanced JSON object `{...}`
3. Repairing common LLM formatting slop (trailing commas, unterminated strings, missing closing braces)
4. Parsing the repaired JSON

If repair fails, the rule is recorded as skipped (judge-failed) and execution continues to the next rule.

Critical: JSON repair applies ONLY to the guardrail judge's internal response. The client-facing provider response is never altered. Wire-format transparency is absolute.

### Fallback Models

Model-based guardrail rules (topic, moderation, semantic) support an optional ordered list of fallback model IDs. If the primary judge/embedding model is missing or returns a model error, Routerly tries the fallbacks in order.

Exception: if the judge model returns a usage/budget-exceeded error, the rule fails immediately and does NOT fall through to fallbacks. Budget exceeded is fail-closed, treating it as a blocked rule.

When a fallback is used, it is recorded in the trace as `skipped: <reason>` for the primary model and a fresh evaluation for the fallback.

### Prompt Injection Detection

The `detectInjection` flag enables a built-in prompt-injection detector that runs on every request before rule evaluation. Detection uses heuristic patterns (e.g. "ignore previous instructions", DAN mode, jailbreak attempts). A hit is equivalent to a rule block and is logged but does not support custom messages.

### Injection Flag: Soft Steering

The `inject` flag (topic/moderation only) appends the rule's instruction to the outgoing request system prompt so the serving model self-enforces the policy. Injection is soft steering: it does not guarantee a block, does not call the judge, and does not log (unless the judge also flags the rule, which happens when a rule has both `inject` and a `target`). The request payload is mutated with the injected text, which is an explicit opt-in guardrail feature allowed under wire-format transparency.

Injection always applies to the request regardless of the `target` setting (which only scopes the judge). A rule with only `inject` enabled (no `target`) skips the judge entirely and just steers.

### Scope: Request, Response, or Both (or Inject Only)

Judged rules can evaluate:
- **request:** Judge the user messages before they are sent to the model
- **response:** Judge the model responses before they are returned to the client
- **both:** Judge both user and model messages
- **inject only:** Skip the judge and append the rule instruction to the system prompt only (topic/moderation only)

### Streaming Interaction

When **any** enabled judged rule has a `response` or `both` target, the entire response must be buffered before the block decision is made. This disables streaming for the request, and the client receives the full response as a single chunk.

All other configurations allow streaming:
- Request-only judged rules allow streaming
- Inject-only rules allow streaming
- Regex/semantic rules on request allow streaming

The Playground and dashboard Security tab clearly indicate when streaming will be disabled due to response-side judge rules.

### Enabled Flag

Rules can be disabled individually via the `enabled` field. Disabled rules are skipped during evaluation and do not trigger block or log actions.

### Usage Attribution

When a judge model is called (semantic, topic, moderation rules), the call is recorded as a separate usage entry with `callType: "guardrail"`. These records are attributed to the same router and token and are subject to the same budget limits.

When a request is blocked by a guardrail, a usage entry is created with `outcome: "blocked"`, `callType: "guardrail"`, zero tokens and cost, and `blockedBy` set to the rule identifier.

---

## PII Scrubbing

PII detection and scrubbing uses a list of policies. Each policy defines:
- Which entity types and custom patterns to detect
- Which direction(s) to scrub (request, response, or both)
- A streaming buffer size for response scrubbing

All enabled policies are merged per-direction at scrub time:
- **Request scrubbing:** Merges all policies with `target: request` or `target: both`
- **Response scrubbing:** Merges all policies with `target: response` or `target: both`

### Entity Types

Built-in entity types (detected via heuristic patterns):
- **EMAIL**: replaced with `[EMAIL]`
- **PHONE**: replaced with `[PHONE_NUMBER]`
- **CREDIT_CARD**: replaced with `[CREDIT_CARD]`
- **SSN**: replaced with `[SSN]`
- **IBAN**: replaced with `[IBAN]`

### Custom Patterns

Each policy can include additional regex patterns (case-insensitive). Matched text is replaced with `[REDACTED]` and is logged in the usage record under `piiRedacted`.

### Streaming Buffer

Response scrubbing must buffer the final N characters of each chunk to catch patterns spanning chunk boundaries. The `outputBufferSize` field (10-500 characters, default 30) controls this buffer per policy. When multiple response policies are active, the largest buffer size is used.

### Direction Merge

Policies are merged by direction at scrub time:
- Request direction includes all policies with `target: request` or `target: both`
- Response direction includes all policies with `target: response` or `target: both`

The merged effective policy combines all entity types and custom patterns. Duplicate entity types are deduplicated.

### Enabled Flag

Policies can be disabled via the `enabled` field. Disabled policies are skipped and do not participate in scrubbing.

### Usage Attribution

When PII is detected and redacted, the usage record gains a `piiRedacted` field listing the entity types that were replaced. Scrubbing itself does not create separate usage entries.

---

## Combined Behavior

When both guardrails and PII scrubbing are active, the processing order is:

1. **Request flow:**
   - Injection detection (if enabled)
   - PII scrubbing (request policies) so the judge never sees raw PII
   - Guardrail rules (request/both target) evaluate the scrubbed request before it is forwarded to the model
2. **Response flow:**
   - PII scrubbing (response policies) on the provider's response
   - Guardrail rules (response/both target) evaluate the scrubbed response

If any request-side guardrail blocks, the request is rejected and does not reach the model. If any response-side guardrail blocks, the response is rejected before being returned to the client.

Both block outcomes return HTTP 200 with wire-faithful content-filter responses (`finish_reason: "content_filter"` for OpenAI, `stop_reason: "refusal"` for Anthropic). Empty content is returned. The usage record will have `outcome: "blocked"` and `callType: "guardrail"`, with `blockedBy` set to the rule identifier.
