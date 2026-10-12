# 16 - MCP and client integrations

MCP server and tokens (`routerly mcp`, `/api/me/mcp-*`), and one-click client configuration (`routerly clients`, Connect page).

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-16-01 - MCP tokens
**Surfaces:** cli, dashboard, service
**Preconditions:** Logged-in user
**Steps:**
1. `routerly mcp token create <name> --expires 2026-10-19 --json`, `list`, `remove <id>`; dashboard MCP token page; `GET /api/me/mcp-tokens`.
**Expected:** Token shown once, listed afterwards without its secret, removable.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/16-01 (catalog fixed: --expires takes a date, not 7d)

### UAT-16-02 - MCP tools list
**Surfaces:** cli, service
**Preconditions:** MCP token
**Steps:**
1. `routerly mcp tools --json`; `GET /api/me/mcp-tools`.
**Expected:** Tools reflect the user's permissions.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/16-02 (admin 9 tools, viewer 7 without create_router_token/toggle_model)

### UAT-16-03 - Run an MCP tool
**Surfaces:** cli
**Preconditions:** MCP token
**Steps:**
1. `routerly mcp test <tool> --input '{}' --token <t> --json`.
**Expected:** Tool returns a result; an expired or revoked token is rejected.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/16-03 (expired and revoked tokens rejected)

### UAT-16-04 - MCP over HTTP and stdio
**Surfaces:** service, cli
**Preconditions:** MCP token, an MCP-capable client
**Steps:**
1. Connect over HTTP; run `routerly mcp serve --token <t>` over stdio.
**Expected:** Both transports list and call tools.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - FAIL (sha 1ce1d2a2) - HTTP OK; stdio answers first requests then child exits 1 with EADDRINUSE :3000 when the service runs on the same host, ERROR log on stdout - evidence: tmp/evidence/16-04

### UAT-16-05 - Clients: endpoints and inspect
**Surfaces:** cli, dashboard
**Preconditions:** None
**Steps:**
1. `routerly clients list --json`, `endpoints --json`, `inspect <id> --json`; dashboard Connect page.
**Expected:** Known clients and endpoints are listed; the Connect page matches.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/16-05 (11 clients in CLI and Connect page)

### UAT-16-06 - Configure a client with backup and undo
**Surfaces:** cli
**Preconditions:** A supported client installed on the test machine
**Steps:**
1. `routerly clients configure <id> --router <r> --token <t> --yes`, `doctor`, then `undo <backupId>`.
**Expected:** Client config points at Routerly after configure; undo restores the original file.
**Real-provider proof:** n/a (no provider call)
**Last run:** 2026-10-12 - PASS (sha 1ce1d2a2) - evidence: tmp/evidence/16-06 (claude-code and codex real installs: configure, doctor, undo restores byte-identical file; other clients BLOCKED, GUI/not installable)
