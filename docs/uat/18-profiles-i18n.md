# 18 - Profiles and internationalization

Prompt/routing profiles per router and the 41-language dashboard.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-18-01 - Create, clone, delete a profile
**Surfaces:** cli, dashboard, service
**Preconditions:** None
**Steps:**
1. `routerly profiles create --json`, `clone <baseId>`, `delete <id>`; dashboard Profiles; `GET /api/profiles`.
**Expected:** Profile lifecycle is consistent across surfaces.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-18-02 - Assign a profile to a router
**Surfaces:** cli, service
**Preconditions:** Profile and router
**Steps:**
1. `routerly profiles set <router> <kind> <profileId>`, `get <router> --json`, `PUT /api/routers/:id/profiles`; `set ... --none`.
**Expected:** Assignment persists; `--none` clears it.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-18-03 - Language selector
**Surfaces:** dashboard
**Preconditions:** Logged in
**Steps:**
1. Change language in the sidebar selector; reload; open Profile, Preferences.
**Expected:** Language applies immediately, persists server-side and is shown in `routerly auth whoami --json`.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-18-04 - RTL languages
**Surfaces:** dashboard
**Preconditions:** None
**Steps:**
1. Switch to Arabic, Hebrew, Urdu.
**Expected:** Layout mirrors without overlap or clipped controls.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-18-05 - Fallback to English
**Surfaces:** dashboard
**Preconditions:** A language with an untranslated key
**Steps:**
1. Browse the pages.
**Expected:** Missing strings show English, never a key name.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-18-06 - Instance default language
**Surfaces:** cli, dashboard, service
**Preconditions:** Admin
**Steps:**
1. `routerly service configure --default-language de`; log in as a user with no preference; try an invalid code (11 chars) via `PUT /api/settings`.
**Expected:** New users get the default; resolution order is personal, browser, instance, English; invalid code is rejected with 400.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
