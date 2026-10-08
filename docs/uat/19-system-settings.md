# 19 - Settings, system and integrations

Service configuration, permissions, modules, telemetry, observability integrations and help.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-19-01 - Service status and health
**Surfaces:** cli, service
**Preconditions:** Service running
**Steps:**
1. `routerly status --json`, `routerly service status`, `routerly service health --json`, `GET /api/system/info`.
**Expected:** All report the running version and healthy state.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-02 - Configure the service
**Surfaces:** cli, dashboard
**Preconditions:** Admin
**Steps:**
1. `routerly service configure --log-level debug --metrics`; dashboard Settings.
**Expected:** Settings are saved and visible in Settings and `GET /api/settings`.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-03 - Metrics endpoint
**Surfaces:** cli
**Preconditions:** Metrics enabled with `--metrics-token`
**Steps:**
1. `routerly service metrics --raw`; fetch without the token.
**Expected:** Raw Prometheus text with the token; refused without it.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-04 - Permission guard and fix
**Surfaces:** cli, dashboard
**Preconditions:** A secret-tier config file set to mode 0644
**Steps:**
1. Restart the service; `routerly permissions fix --yes --json`; dashboard Settings, Security.
**Expected:** The service refuses or warns per tier; fix restores 0600 and the banner disappears everywhere without a reload.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-05 - Modules
**Surfaces:** cli, service
**Preconditions:** None
**Steps:**
1. `routerly modules list --json`, `disable <id>`, `enable <id>`; `GET /api/modules`.
**Expected:** Module state changes and the feature it controls appears or disappears.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-06 - Telemetry opt-in/out
**Surfaces:** cli
**Preconditions:** None
**Steps:**
1. `routerly telemetry status`, `off`, `on`.
**Expected:** Status follows the command.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-07 - Observability integration
**Surfaces:** cli, dashboard
**Preconditions:** A reachable backend (for example a Langfuse-style endpoint)
**Steps:**
1. `routerly integrations add --name x --protocol ... --endpoint ...`, `test <id>`, `traces <id> on --sample-rate 1`.
**Expected:** Test succeeds; sent traces appear in the backend.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-08 - Integration secrets
**Surfaces:** service
**Preconditions:** Integration with a token
**Steps:**
1. `GET /api/integrations/:id`.
**Expected:** Secret fields are masked or omitted.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-09 - Help page
**Surfaces:** dashboard
**Preconditions:** None
**Steps:**
1. Open Help.
**Expected:** Page renders with working links and no missing strings.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-19-10 - Dashboard visual check
**Surfaces:** dashboard
**Preconditions:** Light and dark theme
**Steps:**
1. Visit every page in both themes at desktop and phone width.
**Expected:** No layout breaks, empty states and loading states present, correct theme colors.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
