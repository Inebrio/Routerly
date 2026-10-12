# 14 - Optimizers

Prompt/context optimizers (`session-dedup`, `ccr`, `rtk`, `headroom`, `relevance`, `json-table`, `caveman`, `llmlingua2`). See `packages/service/src/modules/optimizers/README.md` for each one's contract.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-14-01 - List optimizers and fixtures
**Surfaces:** cli, service
**Preconditions:** None
**Steps:**
1. `routerly optimizers list --json`; `GET /api/optimizers`; `routerly optimizers fixtures --json`.
**Expected:** Registry lists every optimizer with id and class; fixtures list is parseable.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - 8 optimizers via CLI and GET /api/optimizers, 4 fixtures parse; evidence: tmp/evidence/UAT-14-01/

### UAT-14-02 - Configure a router pipeline
**Surfaces:** cli, dashboard
**Preconditions:** Router exists
**Steps:**
1. `routerly optimizers config <router> --enable session-dedup --order session-dedup`; dashboard optimizer section.
**Expected:** Pipeline order and enabled state match on both surfaces.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - CLI config and dashboard Optimizer tab agree on order and enabled in both directions; catalog fixed: --order takes ids, not a number; evidence: tmp/evidence/UAT-14-02/

### UAT-14-03 - Preview does not call the provider
**Surfaces:** cli, service
**Preconditions:** Pipeline with `rtk`
**Steps:**
1. `routerly optimizers preview <router> --message '...' --json`; `POST /api/optimizers/preview`.
**Expected:** Preview returns the transformed messages and per-step saving; no usage record is created.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - CLI and POST preview return transformed messages and per-step saving (15 to 11 tokens), 0 upstream calls, no usage record; evidence: tmp/evidence/UAT-14-03/preview.txt

### UAT-14-04 - session-dedup keeps wire semantics
**Surfaces:** service
**Preconditions:** `session-dedup` enabled
**Steps:**
1. Send a conversation where the same message repeats 3 or more times in a row.
**Expected:** Middle repeats are dropped, first and last kept; a conversation with images or tool calls differing in payload is not collapsed.
**Real-provider proof:** Provider-echoed model string and real token counts in the response.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - 5 repeats keep first+last, differing images/tool_calls not collapsed, real gpt-4.1-nano prompt_tokens 56 vs 95 without; evidence: tmp/evidence/UAT-14-04/dedup.txt

### UAT-14-05 - ccr condenses old turns
**Surfaces:** service
**Preconditions:** `ccr` enabled, threshold 3
**Steps:**
1. Send a long multi-turn conversation.
**Expected:** Older turns appear as one `[Condensed earlier context]` block merged into the first kept message; tool-use/tool-result pairs are not split.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - 13 messages become 7, [Condensed earlier context] merged into first kept message, tool pair intact; evidence: tmp/evidence/UAT-14-05/ccr.txt

### UAT-14-06 - rtk compacts whitespace only
**Surfaces:** service
**Preconditions:** `rtk` enabled
**Steps:**
1. Send a message with runs of blank lines and spaces plus an image part.
**Expected:** Whitespace is collapsed; message count, order and non-text parts are unchanged.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - whitespace collapsed, 4 messages and image part unchanged; evidence: tmp/evidence/UAT-14-06/rtk.txt

### UAT-14-07 - headroom trims to the context window
**Surfaces:** service
**Preconditions:** `headroom` enabled
**Steps:**
1. Send a conversation larger than the model's window.
**Expected:** Oldest whole turns are removed until the prompt fits, minus the reserved headroom.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - 22 messages trimmed to 10 on a 4000-token window (first request after boot skipped, cold cache, as documented); evidence: tmp/evidence/UAT-14-07/headroom.txt

### UAT-14-08 - llmlingua2 model install
**Surfaces:** cli
**Preconditions:** Network access
**Steps:**
1. `routerly optimizers model --install --json`; `GET /api/optimizers/llmlingua2/model`.
**Expected:** Model downloads once and status reports installed; without it the optimizer reports unavailable rather than failing requests.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - install reached state ready once, unavailable without it (step skipped, request OK), 1023 to 655 chars after; evidence: tmp/evidence/UAT-14-08/

### UAT-14-09 - Savings are recorded
**Surfaces:** cli, dashboard
**Preconditions:** Optimizer active with measurable saving
**Steps:**
1. Send requests; `routerly report savings --json`.
**Expected:** Savings are non-zero and attributed to the optimizer.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - report savings lists non-zero tokensSaved per optimizer, dashboard Overview shows 4.7k cut by optimizers; evidence: tmp/evidence/UAT-14-09/
