# 09 - Usage, sessions and reports

Usage records, sessions, traces and the reporting commands. Requires real traffic from areas 05 to 08 so counts are real.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-09-01 - Usage record per request
**Surfaces:** dashboard, cli, service
**Preconditions:** Three real requests sent through one router
**Steps:**
1. Dashboard Usage page, `routerly report usage --period 1d --json`, `GET /api/usage`.
**Expected:** Three records on every surface with matching model, tokens and cost; token counts equal the provider's reported usage.
**Real-provider proof:** Provider-echoed model string and real token counts in the response.
**Last run:** never run - BLOCKED - evidence: -

### UAT-09-02 - Usage detail page
**Surfaces:** dashboard, service
**Preconditions:** A usage record exists
**Steps:**
1. Open a record from Usage; `GET /api/usage/:id`.
**Expected:** Detail shows request metadata and cost; fields agree with the API.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-09-03 - Filters
**Surfaces:** cli, dashboard
**Preconditions:** Records from two routers and two tokens
**Steps:**
1. `routerly report usage --router <r> --token <t> --tag <x> --end-user <u> --json`; dashboard filters.
**Expected:** Each filter narrows the result to exactly the matching records.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-09-04 - Calls and leaderboard
**Surfaces:** cli, service
**Preconditions:** Records exist
**Steps:**
1. `routerly report calls --limit 5`, `routerly report leaderboard --period 7d --json`, `GET /api/leaderboard`.
**Expected:** Calls lists the latest five; leaderboard is ordered and parseable.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-09-05 - Sessions
**Surfaces:** cli, dashboard, service
**Preconditions:** Requests sharing a session id
**Steps:**
1. `routerly report sessions --json`, `GET /api/sessions`, `GET /api/sessions/:id/requests`.
**Expected:** Requests are grouped under one session on all surfaces.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-09-06 - Savings report
**Surfaces:** cli
**Preconditions:** Optimizer or cache savings exist (area 14)
**Steps:**
1. `routerly report savings --period 7d --trend --json`.
**Expected:** Savings are reported and parseable; zero savings is reported as zero, not an error.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-09-07 - Usage is append-only and bounded
**Surfaces:** service
**Preconditions:** Retention configured
**Steps:**
1. `routerly service configure --usage-retention-days 1 --usage-retention-max-mb 5`; generate traffic; inspect `usage.ndjson`.
**Expected:** Records are appended; old records are pruned according to retention; service memory stays flat.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-09-08 - Trace of a request
**Surfaces:** service, dashboard
**Preconditions:** Trace content capture enabled on a router
**Steps:**
1. Send a request; `GET /api/traces/:id`; open the usage record's trace.
**Expected:** Trace shows the routing decision steps; with capture disabled no message content is stored.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
