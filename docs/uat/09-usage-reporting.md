# 09 - Usage, sessions and reports

Usage records, sessions, traces and the reporting commands. Requires real traffic from areas 05 to 08 so counts are real.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-09-01 - Usage record per request
**Surfaces:** dashboard, cli, service
**Preconditions:** Three real requests sent through one router
**Steps:**
1. Dashboard Usage page, `routerly report usage --period daily --json`, `GET /api/usage`.
**Expected:** Three records on every surface with matching model, tokens and cost; token counts equal the provider's reported usage.
**Real-provider proof:** Provider-echoed model string and real token counts in the response.
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-09-01 (3 real gpt-4.1-nano calls; CLI/API/dashboard agree, tokens 18/1,18/2,18/1 = provider usage, cost = tokens x price)

### UAT-09-02 - Usage detail page
**Surfaces:** dashboard, service
**Preconditions:** A usage record exists
**Steps:**
1. Open a record from Usage; `GET /api/usage/:id`.
**Expected:** Detail shows request metadata and cost; fields agree with the API.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-09-02 (detail page fields = API; note: page shows no session/end-user/tags/traceId)

### UAT-09-03 - Filters
**Surfaces:** cli, dashboard
**Preconditions:** Records from two routers and two tokens
**Steps:**
1. `routerly report usage --router <r> --token <t> --tag <x> --end-user <u> --json`; dashboard filters.
**Expected:** Each filter narrows the result to exactly the matching records.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-09-03 (CLI router/token/tag/end-user/session filters exact; dashboard router+token only, no tag/end-user filter UI; repeated --tag keeps only the last)

### UAT-09-04 - Calls and leaderboard
**Surfaces:** cli, service
**Preconditions:** Records exist
**Steps:**
1. `routerly report calls --limit 5`, `routerly report leaderboard --period weekly --json`, `GET /api/leaderboard`.
**Expected:** Calls lists the latest five; leaderboard is ordered and parseable.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: evidence/UAT-09-04/calls-crash.txt (`report calls` crashes "Cannot read properties of null (reading toFixed)" when a row has cost null; leaderboard OK)

### UAT-09-05 - Sessions
**Surfaces:** cli, dashboard, service
**Preconditions:** Requests sharing a session id
**Steps:**
1. `routerly report sessions --json`, `GET /api/sessions`, `GET /api/sessions/:id/requests`.
**Expected:** Requests are grouped under one session on all surfaces.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: evidence/UAT-09-05 (API and `--json` group correctly; `report sessions` without --json crashes "data is not iterable"; dashboard has no sessions view)

### UAT-09-06 - Savings report
**Surfaces:** cli
**Preconditions:** Optimizer or cache savings exist (area 14)
**Steps:**
1. `routerly report savings --period weekly --trend --json`.
**Expected:** Savings are reported and parseable; zero savings is reported as zero, not an error.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-09-06 (parseable; zero savings reported as 0; optimizer/cache savings not exercised, area 14)

### UAT-09-07 - Usage is append-only and bounded
**Surfaces:** service
**Preconditions:** Retention configured
**Steps:**
1. `routerly service configure --usage-retention-days 1 --usage-retention-max-mb 5`; generate traffic; inspect `usage.ndjson`.
**Expected:** Records are appended; old records are pruned according to retention; service memory stays flat.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-09-07 (append-only prefix identical; age and size pruning verified, RSS flat; --usage-retention-max-mb rejects fractions)

### UAT-09-08 - Trace of a request
**Surfaces:** service, dashboard
**Preconditions:** Trace content capture enabled on a router
**Steps:**
1. Send a request; `GET /api/traces/:id`; open the usage record's trace.
**Expected:** Trace shows the routing decision steps; with capture disabled no message content is stored.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: evidence/UAT-09-08 (routing steps present; capture off stores no content; with capture ON no prompt/answer appears for completion calls, code only attaches content to LLM-routing calls)
