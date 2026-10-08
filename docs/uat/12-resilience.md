# 12 - Resilience

Circuit breakers, connection cooldowns and model lockouts (`routerly resilience`, `GET /api/resilience`). Needs a deliberately failing real connection (invalid key) and a rate-limited one.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-12-01 - Status when healthy
**Surfaces:** cli, service, dashboard
**Preconditions:** Healthy traffic
**Steps:**
1. `routerly resilience status --json`; `GET /api/resilience`.
**Expected:** No open breakers or cooldowns; JSON parseable.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-12-02 - Breaker opens after repeated provider errors
**Surfaces:** service, cli
**Preconditions:** A connection with an invalid key in a router with a fallback
**Steps:**
1. Send repeated requests until the breaker opens; `resilience status`.
**Expected:** The failing target is reported unavailable; subsequent requests are served by the fallback without hitting the failing upstream.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-12-03 - Cooldown on rate limit
**Surfaces:** service
**Preconditions:** Provider returns 429 with `retry-after` (use a low-quota key)
**Steps:**
1. Trigger a 429.
**Expected:** The connection is in cooldown for about the `retry-after` period and is skipped meanwhile.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-12-04 - Lockout on model not found
**Surfaces:** service
**Preconditions:** A model id the provider does not know
**Steps:**
1. Send a request.
**Expected:** The model instance is locked out for a period and skipped.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-12-05 - Half-open probe
**Surfaces:** service
**Preconditions:** Breaker open, cool-down elapsed
**Steps:**
1. Send a request after the open period.
**Expected:** At most one probe request reaches the provider; success closes the breaker.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-12-06 - Reset
**Surfaces:** cli, service
**Preconditions:** State present
**Steps:**
1. `routerly resilience reset`; `reset --level connection --id <id>`; reset with only one of `--level`/`--id`.
**Expected:** Reset clears state; the partial form is rejected with a clear error.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-12-07 - Permission gating
**Surfaces:** service
**Preconditions:** User without `resilience:manage`
**Steps:**
1. `POST` reset with that user's token.
**Expected:** HTTP 403.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-12-08 - Router timeout
**Surfaces:** service
**Preconditions:** Router timeout of a few seconds, slow model
**Steps:**
1. Send a request that takes longer than the timeout.
**Expected:** The request is aborted at the timeout and falls over or returns a provider-shaped error.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
