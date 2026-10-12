# 17 - Notifications

Inbox and delivery channels.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-17-01 - Inbox events
**Surfaces:** dashboard, cli, service
**Preconditions:** An event-producing action (for example a budget breach)
**Steps:**
1. `routerly notification list --unread --json`; `GET /api/notifications/inbox`; dashboard bell.
**Expected:** The event appears on all surfaces with severity and category.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-17-01/ (dashboard channel enables inbox; CLI, HTTP, bell show events with severity; category via --category filter)

### UAT-17-02 - Read, unread, archive
**Surfaces:** cli, dashboard
**Preconditions:** Several notifications
**Steps:**
1. `notification read <id>`, `unread <id>`, `archive <ids...>`, `archive --all`.
**Expected:** State and counters change accordingly.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-17-02/ (read/unread/archive/--all counters verified CLI+HTTP, dashboard Mark all read)

### UAT-17-03 - Create channel and test it
**Surfaces:** cli, dashboard
**Preconditions:** A reachable webhook or SMTP target
**Steps:**
1. `routerly notification channel create ... --events ...`; `test <id> --to ...`.
**Expected:** Test message is delivered to the target.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-17-03/ (SMTP sink received test mail via CLI and dashboard; webhook only after hostname alias, loopback blocked by SSRF guard)

### UAT-17-04 - Channel targeting
**Surfaces:** cli
**Preconditions:** Channel with `--target-roles`
**Steps:**
1. Trigger an event.
**Expected:** Only the targeted roles receive it.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-17-04/ (--target-roles viewer -> only viewer email, operator -> only operator email)

### UAT-17-05 - Edit and delete channel
**Surfaces:** cli, dashboard
**Preconditions:** Channel exists
**Steps:**
1. `channel edit <id> --cooldown-seconds 60`, `channel delete <id>`.
**Expected:** Changes persist; delete stops deliveries.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-17-05/ (cooldown/name persist (CLI, HTTP, dashboard); after delete 0 deliveries. CLI cannot clear --target-roles with empty string)

### UAT-17-06 - Cooldown
**Surfaces:** service
**Preconditions:** Channel with cooldown
**Steps:**
1. Trigger the same event twice quickly.
**Expected:** Only one delivery occurs within the cooldown.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-17-06/ (3 events in <60s -> 1 mail; 1 more after 60s)

### UAT-17-07 - Secrets are not exposed
**Surfaces:** service
**Preconditions:** Channel with a password or token
**Steps:**
1. `GET /api/notifications/channels/:id`.
**Expected:** Secret fields are masked or omitted.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: /root/.claude/jobs/2718551b/tmp/evidence/UAT-17-07/ (smtp password and webhook secret returned as ********, no leak)
