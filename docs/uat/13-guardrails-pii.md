# 13 - Guardrails and PII

Per-router guardrails (`routerly router guardrails`) and PII policies (`routerly router pii`). LLM-judged guardrails need a real judge model.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-13-01 - Show and update guardrails
**Surfaces:** cli, dashboard
**Preconditions:** Router exists
**Steps:**
1. `routerly router guardrails <router>`, then update; dashboard Guardrails section.
**Expected:** Config shown and updated identically on both surfaces.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - CLI show/--remove-rule and dashboard Security tab agree; CLI --add-rule wizard broken, see 13-04; evidence: tmp/evidence/UAT-13-01/

### UAT-13-02 - Block a prohibited prompt
**Surfaces:** service
**Preconditions:** Keyword or pattern guardrail enabled
**Steps:**
1. Send a prompt matching the rule; then a clean prompt.
**Expected:** The matching prompt is refused with a provider-shaped error and nothing reaches the provider; the clean prompt succeeds.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - regex block returns 200 finish_reason=content_filter (OpenAI) / stop_reason=refusal (Anthropic) with empty content, upstream saw 0 calls; evidence: tmp/evidence/UAT-13-02/regex-block.txt

### UAT-13-03 - Semantic or topic guardrail with a real judge
**Surfaces:** service
**Preconditions:** Judge model configured
**Steps:**
1. Send an off-topic prompt and an on-topic prompt.
**Expected:** Off-topic is blocked, on-topic passes.
**Real-provider proof:** Provider-echoed model string and real token counts in the response.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - real gpt-4.1-nano judge (guardrail usage 398/25 tokens), off-topic blocked, on-topic served by gpt-4.1-nano-2025-04-14; evidence: tmp/evidence/UAT-13-03/topic-real.txt

### UAT-13-04 - Add and list PII policies
**Surfaces:** cli
**Preconditions:** Router exists
**Steps:**
1. `routerly router pii add <router> ...`, `routerly router pii list <router>`.
**Expected:** The policy is listed with the chosen entity types and action.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - `router pii add` wizard saves empty target ("Invalid pii config"; inquirer 13.3.2 does not render type "list" prompts); `pii list` OK on a policy added via API; evidence: tmp/evidence/UAT-13-04/

### UAT-13-05 - PII scrub on request
**Surfaces:** service
**Preconditions:** PII policy with scrub action; recording proxy or provider logs available
**Steps:**
1. Send a prompt containing an email address and a phone number.
**Expected:** The provider receives placeholders instead of the values; the rest of the payload is unchanged.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - stub upstream received [EMAIL]/[PHONE_NUMBER], other messages intact; evidence: tmp/evidence/UAT-13-05/request-scrub-stub.txt

### UAT-13-06 - PII scrub on response
**Surfaces:** service
**Preconditions:** Prompt that makes the model echo the PII
**Steps:**
1. Ask the model to repeat the email address.
**Expected:** The client response has the PII scrubbed per policy.
**Real-provider proof:** Provider-echoed model string and real token counts in the response.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - real gpt-4.1-nano echoed the email, client got [EMAIL] (non-stream and stream); evidence: tmp/evidence/UAT-13-06/response-scrub-real.txt

### UAT-13-07 - Streaming with guardrails
**Surfaces:** service
**Preconditions:** Guardrail and PII enabled
**Steps:**
1. Repeat a blocked and a clean request with `stream: true`.
**Expected:** Behaviour matches non-streaming; no malformed SSE.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - OpenAI stream with response PII policy emits the held-back tail after the finish_reason chunk with a different chunk id/model; Anthropic /v1/messages blocked stream:true returns application/json, not SSE; evidence: tmp/evidence/UAT-13-07/stream-stub.txt
