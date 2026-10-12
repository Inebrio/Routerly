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
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/11/01* (works via localhost tunnel, real gpt-4.1-nano-2025-04-14, 23/1 tokens, usage record; over plain http://192.168.1.26:3000 crypto.randomUUID is not a function, no request sent)

### UAT-11-02 - Streaming render
**Surfaces:** dashboard
**Preconditions:** As above
**Steps:**
1. Send a long prompt.
**Expected:** Text appears incrementally; no stuck spinner at the end.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/11/02-result.json

### UAT-11-03 - Presets
**Surfaces:** dashboard, service
**Preconditions:** Router exists
**Steps:**
1. Save a playground preset; reload; delete it; `GET /api/routers/:id/playground-presets`.
**Expected:** Preset persists and is listed by the API; deletion removes it.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/11/03-*

### UAT-11-04 - Error display
**Surfaces:** dashboard
**Preconditions:** Router whose model is failing
**Steps:**
1. Send a message.
**Expected:** A readable error is shown; the page remains usable.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/11/04.png (error only in Debug panel, clipped; chat bubble empty; stream returns HTTP 200)

### UAT-11-05 - Playground over plain HTTP (non-secure context)
**Surfaces:** dashboard
**Preconditions:** Dashboard opened at `http://<LAN-IP>:3000` (not localhost); a router token
**Steps:**
1. Open `/dashboard/test`, enter the token, send a message.
2. Collect Playwright `pageerror` events.
**Expected:** Reply is shown; no `crypto.randomUUID is not a function` pageerror (ROUT-191).
**Real-provider proof:** reply from a real model (router T-openai-gpt-4.1-nano)
**Last run:** 2026-10-12 - PASS (sha ff61515a) - evidence: dev-box Playwright run, 0 pageerrors, reply "Hello" (before the fix: pageerror + no reply)

### UAT-11-06 - Router Test tab
**Surfaces:** dashboard
**Preconditions:** Dashboard at `http://<LAN-IP>:3000`; router with a token
**Steps:**
1. Open the router, click the Test tab, enter the token, send a message.
2. Also add a Regex policy in router Security tab and in a new security profile (`/dashboard/profiles/new?kind=security`).
**Expected:** Reply and trace shown, policy rows added, no pageerror (ROUT-191).
**Real-provider proof:** reply from a real model
**Last run:** 2026-10-12 - PASS (sha ff61515a) - evidence: dev-box Playwright run, Test tab reached via nav, reply "Hello", 0 pageerrors; policy rows added on HTTP
