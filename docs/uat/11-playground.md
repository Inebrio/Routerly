# 11 - Playground

Dashboard Test page and router test tab.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-11-01 - Send a message
**Surfaces:** dashboard
**Preconditions:** Router with a real model
**Steps:**
1. Open Playground, pick a router, send 'Reply with the word ok'.
**Expected:** A response is rendered; usage shows a new record. Works over plain HTTP as well as HTTPS.
**Real-provider proof:** Provider-echoed model string and real token counts in the response.
**Last run:** never run - BLOCKED - evidence: -

### UAT-11-02 - Streaming render
**Surfaces:** dashboard
**Preconditions:** As above
**Steps:**
1. Send a long prompt.
**Expected:** Text appears incrementally; no stuck spinner at the end.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-11-03 - Presets
**Surfaces:** dashboard, service
**Preconditions:** Router exists
**Steps:**
1. Save a playground preset; reload; delete it; `GET /api/routers/:id/playground-presets`.
**Expected:** Preset persists and is listed by the API; deletion removes it.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-11-04 - Error display
**Surfaces:** dashboard
**Preconditions:** Router whose model is failing
**Steps:**
1. Send a message.
**Expected:** A readable error is shown; the page remains usable.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
