# 15 - A/B experiments

Experiments route traffic across variants with sticky keys and optional LLM judging.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-15-01 - Create an experiment
**Surfaces:** cli, dashboard, service
**Preconditions:** Two routers
**Steps:**
1. `routerly experiments create <name> --variant a=<r1>:50 --variant b=<r2>:50 --rotation weighted --json`; dashboard Experiments page.
**Expected:** Experiment appears with both variants on all surfaces.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/15-01, 15-dash (CLI create/show/list, dashboard list+detail)

### UAT-15-02 - Experiment token
**Surfaces:** cli, service
**Preconditions:** Experiment exists
**Steps:**
1. `routerly experiments token create <id> --json`; call `/v1/chat/completions` with it.
**Expected:** Requests are served by one of the variants; `token list` shows it; `token revoke` stops it.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/15-02 (served by claude-haiku-4-5-20251001; revoke -> 401)

### UAT-15-03 - Distribution
**Surfaces:** service
**Preconditions:** 50/50 weights
**Steps:**
1. Send 100 requests.
**Expected:** Variants receive roughly half each (within sampling noise).
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/15-03 (100 calls: 45 gpt-4.1-nano / 55 haiku, plus 1 earlier)

### UAT-15-04 - Sticky key
**Surfaces:** service
**Preconditions:** `--sticky-key` set
**Steps:**
1. Send repeated requests with the same key value.
**Expected:** The same variant serves them all.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/15-04 (sticky-key end-user, 6 users x5 calls, each user one variant)

### UAT-15-05 - Metrics
**Surfaces:** cli, dashboard
**Preconditions:** Traffic sent
**Steps:**
1. `routerly experiments metrics <id> --days 1 --json`.
**Expected:** Per-variant counts, latency and cost match usage records.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/15-05, 15-dash/metrics.png (calls/tokens equal usage.ndjson sums; cost 0 because models are unpriced)

### UAT-15-06 - Judge scoring
**Surfaces:** service
**Preconditions:** `--judge-model`, `--criteria`, `--sample-rate 1` with a real judge model
**Steps:**
1. Send 10 requests.
**Expected:** Judge scores appear in metrics; `--no-judge` disables scoring.
**Real-provider proof:** Provider-echoed model string and real token counts in the response.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/15-06 (10 calls, judgedCalls 5+5 avgScore 10; --no-judge: judgedCalls stays 5)

### UAT-15-07 - Update and delete
**Surfaces:** cli, dashboard
**Preconditions:** Experiment exists
**Steps:**
1. `routerly experiments update <id> --name ...`, then `delete <id>`.
**Expected:** Changes persist; delete removes the experiment and its tokens.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/15-07, 15-dash (CLI update/delete, dashboard rename+delete, token 401 after delete)

### UAT-15-08 - Input validation
**Surfaces:** cli, service
**Preconditions:** None
**Steps:**
1. Create with weights not summing to 100, an unknown router, a sample rate of 2.
**Expected:** Each is rejected with a clear error.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - weights 70+20 accepted (CLI and HTTP 201); unknown router and sampleRate>1 (HTTP) rejected - evidence: tmp/evidence/15-08
