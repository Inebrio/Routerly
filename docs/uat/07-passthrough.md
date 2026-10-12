# 07 - Passthrough router

Passthrough routers forward the client's request unchanged; real target models can sit beside the fixed pass-through entry.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-07-01 - Create a Passthrough router
**Surfaces:** cli, dashboard
**Preconditions:** None
**Steps:**
1. `routerly router create --name <name> --kind passthrough`; dashboard Passthrough tab, New Passthrough.
**Expected:** Router has the pass-through entry; creation redirects to the General tab with no 'Unsaved Changes' prompt; there is no slug field.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-01/ (CLI create+show, dashboard create -> /general, no unsaved prompt, no slug field)

### UAT-07-02 - Slug derived from the name
**Surfaces:** service
**Preconditions:** Two passthrough routers whose names slugify identically (for example `My App` and `my-app`; identical names are rejected, see 07-03)
**Steps:**
1. Create the second.
**Expected:** The second gets a disambiguated slug (numeric suffix); `slug` is read-only in the response.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-02/ (slugs uat07-pt-a, -2, -3; client-supplied slug ignored on POST and PUT)

### UAT-07-03 - Name uniqueness is per kind
**Surfaces:** service
**Preconditions:** A Router named `X` exists
**Steps:**
1. Create a Passthrough named `X`; then another Passthrough named `X`.
**Expected:** The first succeeds; the second is rejected.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-03/ (Router X + Passthrough X ok, second Passthrough X 409)

### UAT-07-04 - Pass-through entry is fixed
**Surfaces:** cli, dashboard, service
**Preconditions:** Passthrough router
**Steps:**
1. Try to remove or duplicate the pass-through entry on every surface.
**Expected:** Rejected on all surfaces; real models can be added, removed and reordered around it.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-04/ (CLI add/remove refused, API PUT missing/duplicate entry 400, dashboard remove disabled and no add option; reorder works)

### UAT-07-05 - Forward unchanged with the client's credential
**Surfaces:** service
**Preconditions:** Passthrough router, real provider key held by the client
**Steps:**
1. `POST /passthrough/<slug>/v1/chat/completions` with the provider key as the client would.
**Expected:** Upstream sees the client's headers and body unchanged; the response (status, headers, body) is the provider's, byte for byte in content.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-05/ (status+headers forwarded, model/usage reached upstream, but response body is empty, content-length 0)

### UAT-07-06 - Upstream errors are returned as-is
**Surfaces:** service
**Preconditions:** Passthrough router
**Steps:**
1. Send a request with an invalid provider key.
**Expected:** The provider's own 401 body and status are returned, not an empty body or a Routerly-shaped error.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-06/ (401 status and content-type forwarded, provider JSON/text body dropped, empty)

### UAT-07-07 - Real models: token issued and revoked
**Surfaces:** cli, service
**Preconditions:** Passthrough router with no real models
**Steps:**
1. Add the first real model; read the router tokens.
2. Remove the last real model.
**Expected:** A Routerly bearer token exists after the first real model and is revoked after the last.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-07/ (token issued on first real model, revoked on last; old token then 401)

### UAT-07-08 - Pass-through entry position decides the default
**Surfaces:** service
**Preconditions:** Real model and pass-through entry
**Steps:**
1. Entry at index 0: send requests.
2. Move the entry after the real model: send requests, then make the real model ineligible.
**Expected:** At index 0 raw-forward always wins; otherwise the real model is routed and metered, with the entry as last-resort fallback.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-07-08/ (index 0 raw-forward; index 1 routed gpt-4.1-nano-2025-04-14, 9/1 tokens metered; ineligible falls back to raw-forward)
