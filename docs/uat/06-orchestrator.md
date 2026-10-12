# 06 - Orchestrator

Orchestrator routers choose among candidate Routers by priority and policy.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-06-01 - Create an Orchestrator with candidates
**Surfaces:** cli, dashboard
**Preconditions:** Two routers exist
**Steps:**
1. `routerly router create --name <name> --kind orchestrator --candidate <r1> --candidate <r2>`.
2. Dashboard: Orchestrator tab, New Orchestrator form (kind fixed), then Orchestrator tab to add candidates.
**Expected:** Orchestrator lists both candidates in order; creation is two steps in the dashboard (name and timeout, then candidates).
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-06-01/

### UAT-06-02 - Per-candidate limits
**Surfaces:** cli
**Preconditions:** Orchestrator with candidates
**Steps:**
1. `routerly router create ... --candidate-limit <spec>` or edit the candidate in the dashboard.
**Expected:** Limit is stored and shown on both surfaces; requests beyond it skip that candidate.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-06-02/ (limit stored+shown in dashboard and `router show --json`, not in human `router show`; 1st call served by cand 1, calls 2-3 skipped to cand 2, real gpt-4.1-nano/gpt-5-nano echoes)

### UAT-06-03 - Drag-to-reorder candidates
**Surfaces:** dashboard, service
**Preconditions:** Orchestrator with 3 candidates
**Steps:**
1. Drag the last candidate to the top; reload.
2. `GET /api/routers` and pick the entry (there is no `GET /api/routers/:id`, it returns 404).
**Expected:** Order persists and matches the API; there is no numeric weight input; the picker does not show raw router ids.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-06-03/ (HTML5 drag, order persists after reload and in GET /api/routers, no weight input, picker shows names)

### UAT-06-04 - Request goes to the first eligible candidate
**Surfaces:** service
**Preconditions:** Orchestrator with all five policies set `enabled: false` (with default policies the always-on health/rate-limit/fairness blend spreads requests across candidates; only ties go to the first), candidate 1 healthy
**Steps:**
1. Send a request with the orchestrator's token.
**Expected:** Usage record shows candidate 1 served it.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-06-04/ (with all 5 policies enabled:false 5/5 requests served by cand 1, real gpt-4.1-nano-2025-04-14, 11 tokens; with default policies load is spread across candidates by design)

### UAT-06-05 - Failover to the next candidate
**Surfaces:** service
**Preconditions:** Candidate 1 made to fail (invalid key)
**Steps:**
1. Send a request.
**Expected:** Candidate 2 serves the request; the client sees one successful response.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-06-05/ (cand 1 invalid key -> 200 from cand 2 gpt-5-nano-2025-08-07, usage 8/147; usage shows cand1 error then cand2 success)

### UAT-06-06 - Compatible policies are accepted
**Surfaces:** service, dashboard
**Preconditions:** Orchestrator
**Steps:**
1. Enable `health`, `rate-limit`, `fairness`, `performance`, `budget-remaining` through the Routing Policies section or `PUT` on the router.
**Expected:** All five are accepted and honored with their saved settings, including `enabled: false` and custom windows.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: evidence/UAT-06-06/ (API accepts all 5 and round-trips config; dashboard Save Candidates silently flips enabled:false to true, 3/3 repro)

### UAT-06-07 - Incompatible policies are rejected
**Surfaces:** service
**Preconditions:** Orchestrator
**Steps:**
1. Create or update with policy type `cheapest`, `capability`, `context`, `llm`, `semantic-intent` or `model-preference`.
**Expected:** HTTP 400 for each; the orchestrator is unchanged.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-06-07/api.txt (400 for 6 types on PUT, 2 on POST, orchestrator unchanged)

### UAT-06-08 - No candidate available
**Surfaces:** service
**Preconditions:** All candidates failing
**Steps:**
1. Send a request.
**Expected:** The client gets a provider-shaped error, not a hang; the timeout is respected.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: evidence/UAT-06-08/ (unresponsive candidate: non-stream and /v1/messages hang 181s, 2s timeout ignored; fast failures give 503 OK; stream gives empty 200)
