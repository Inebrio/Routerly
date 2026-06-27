---
name: trace-observability-pii-leak-audit
description: How to audit Routerly trace entries (pii/guardrail) for PII/content leakage and wire-format safety
metadata:
  type: project
---

Routerly surfaces guardrail + PII evaluation in the request/response **trace** (in-memory `traceStore`, out-of-band, retrieved only via gated mgmt endpoint + the playground SSE `type:'trace'` events). When auditing any trace-related diff:

**Why:** the trace is the one place where redacted/inspected user content could leak. Wire-format transparency is the absolute project rule.

**How to apply:**
- `pii:evaluated` / `pii:scrubbed` details carry only entity **TYPES** (`EMAIL`, `PHONE_NUMBER`, `CREDIT_CARD`, `SSN`, `IBAN`, `CUSTOM`) — `scrubPii`/`scrubMessages`/`scrubText` in `packages/service/src/middleware/piiScrubber.ts` return a `found`/`redacted` set of types, never the matched value. If a trace ever put `text`/`content`/the matched string in details → BLOCKING leak.
- `guardrail:evaluated` `reason` is safe by construction: injection → `injection:${name}`, regex → `regex:${pattern}` (the configured pattern, not user text), semantic/topic/moderation → a score string. `checkInjection` returns `injection:${name}`, never the hit substring. If `reason` ever becomes the raw matched user text → BLOCKING leak.
- `appendTrace` writes only to the in-memory Map; it never touches `reply`. Confirm the diff adds no new response header / body field on the openai/anthropic proxy routes — `git diff <range> -- routes/openai.ts routes/anthropic.ts | grep '^+' | grep -i 'header\|reply.send\|finish_reason'`.
- `pii:evaluated` is the "ran with 0 redactions" signal: emitted once per active scrub pass (input always when `scrubInput !== false`; output once after stream flush inside `if (outputScrubber)` / once in non-stream `if typeof content === string`). It must NOT duplicate `pii:scrubbed` (which is additional, only when found > 0).
