# Routerly UAT catalog

Real-environment acceptance tests: real browser (Playwright), real CLI, real service API, real upstream providers. Run via the `uat-runner` skill (`.claude/skills/uat-runner/SKILL.md`), never by pasting these steps by hand: the skill's preflight (uat-box reachable, real credentials configured, correct target deployed) keeps a run honest.

The catalog has no version pin. It is re-run against each release; the target ref comes from the run manifest. It was derived from the code surface of `release/0.5.4` (management API routes, CLI command tree, dashboard pages, CHANGELOG), not from the earlier fake-upstream run, which is discarded.

Cases are stable ids `UAT-<area>-<n>`. A Plane bug title `[UAT-FAIL] <id> - ...` refers to one.

## Areas

- [01 - Installation and upgrade](01-installation.md)
- [02 - Authentication and 2FA](02-authentication.md)
- [03 - Users and roles](03-users-roles.md)
- [04 - Connections and models](04-connections-models.md)
- [05 - Routers](05-routers.md)
- [06 - Orchestrator](06-orchestrator.md)
- [07 - Passthrough router](07-passthrough.md)
- [08 - Proxy wire format](08-proxy-wire-format.md)
- [09 - Usage, sessions and reports](09-usage-reporting.md)
- [10 - Audit log](10-audit.md)
- [11 - Playground](11-playground.md)
- [12 - Resilience](12-resilience.md)
- [13 - Guardrails and PII](13-guardrails-pii.md)
- [14 - Optimizers](14-optimizers.md)
- [15 - A/B experiments](15-experiments.md)
- [16 - MCP and client integrations](16-mcp-and-clients.md)
- [17 - Notifications](17-notifications.md)
- [18 - Profiles and internationalization](18-profiles-i18n.md)
- [19 - Settings, system and integrations](19-system-settings.md)

## Run history

See `docs/uat/runs/` for each completed run report.
