# 10 - Audit log

Management actions are audited and viewable.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-10-01 - Actions are logged
**Surfaces:** cli, dashboard, service
**Preconditions:** Admin session
**Steps:**
1. Create then delete a router; `routerly audit list --json`; dashboard Audit page.
**Expected:** Both actions appear with user, action and result.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/10/UAT-10-01/

### UAT-10-02 - Forbidden attempts are logged
**Surfaces:** service
**Preconditions:** User lacking a permission
**Steps:**
1. Trigger a 403.
**Expected:** An audit entry with result `forbidden` exists.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/10/UAT-10-02/

### UAT-10-03 - Audit filters
**Surfaces:** cli
**Preconditions:** Several audit entries
**Steps:**
1. `routerly audit list --user <u> --action <a> --from <d> --to <d> --limit 5 --json`.
**Expected:** Output contains only matching entries, at most five.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/10/UAT-10-03/ (CLI --limit sent as limit=, service reads pageSize: 273 entries -> 50 returned, limit 5 ignored; --to 2026-10-12 excludes same-day entries)
