---
name: uat-runner
description: Run a real-environment UAT sweep (browser + CLI + service) against a Routerly build, judging each catalog test case with real evidence and filing a Plane bug per genuine failure. Use when asked to run or update the UAT catalog in docs/uat/ (ROUT-13 and its sub-items). Trigger: /uat-runner
---

# UAT runner

Runs the catalog in `docs/uat/` against a real Routerly instance: real browser
(Playwright), real CLI, real service API, real upstream providers. A provider
call is never mocked. A case that cannot reach a real provider is BLOCKED, never PASS.

Playwright runs on the dev-box and points at the uat-box. CLI commands run on the
uat-box over ssh. Playwright needs `--no-sandbox`.

## Run manifest

The invoker states, before anything else:

- `target`: git ref to deploy and test (for example `origin/release/0.5.4`). Never assume
  the previous target is still current; check the release-branch note in `.ai/memory.md`.
- `host`: uat-box address (LXC 118, `192.168.1.26`; Proxmox `192.168.1.7`).
- `sections`: which `docs/uat/NN-*.md` files to run, or `all`.

## Step 0 - preflight, always, before any case

1. `ssh root@192.168.1.7 'pct status 118'`. If not `running`: `pct start 118` and wait.
2. `ssh root@<host> 'echo OK'`. On `Permission denied`, STOP. Do not fall back to password
   auth or API-only testing: without ssh there is no way to deploy `target` or read service
   logs. Report that the `uat-clean` snapshot needs its ssh key re-cut, and end the run.
3. Rollback for the install section: `ssh root@192.168.1.7 'pct stop 118 && pct rollback 118 uat-clean && pct start 118'`.
   For feature sections without reinstalling, roll back to `uat-installed` the same way.
   Create `uat-installed` after a good install: `pct stop 118 && pct snapshot 118 uat-installed && pct start 118`.
4. Deploy exactly `target` and record the commit SHA. Every finding references it.
5. Confirm real provider credentials are configured in the uat-box Routerly instance
   (`~/.routerly/config/` inside the container). A missing or placeholder key makes that
   provider's cases BLOCKED. A stub credential must never produce a PASS. Tokens live only in
   the gitignored KB and on the uat-box, never in git.

## Running one case

Every case in `docs/uat/*.md` uses this template:

```markdown
### UAT-<area>-<n> - <short title>
**Surfaces:** dashboard | cli | service | all three
**Preconditions:** <exact starting state>
**Steps:** <numbered, exact: clicks, commands, requests>
**Expected:** <exact observable outcome>
**Real-provider proof (if applicable):** <field a stub could not fabricate: model string
  echoed by the provider, token usage, provider-specific error shape>
**Last run:** <date> - PASS | FAIL | BLOCKED - evidence: <path or request id>
```

Execute the steps for real: Playwright for dashboard steps, the actual `routerly` binary
for CLI steps, direct HTTP for service steps. Capture evidence before writing a verdict:
a screenshot (session scratchpad only, never the repo), raw CLI output, or the raw HTTP
response. Update the case's `Last run` line in place.

## Judging and filing

- PASS: exact expected outcome observed, with evidence.
- FAIL: reproducible deviation from expected. File a separate Plane bug immediately:
  `/opt/routerly/plane.sh GET labels/` for the `bug` label id, then
  `/opt/routerly/plane.sh POST work-items/ '{"name":"[UAT-FAIL] <case-id> - <one line>","state":"<STATE_BACKLOG>","label_ids":["<bug-label-id>"],"description_html":"<repro, expected vs actual, evidence, commit SHA>"}'`.
  Post the new id as a comment on the current item. Pause 3 s between calls (Plane rate limit).
  Before filing, rule out an environment cause (credentials, upstream down, stale build).
- BLOCKED: the case could not be judged for real. Record why; never guess a verdict.

## Run report

At the end of a run write `docs/uat/runs/<date>-<target-sha>.md`: PASS/FAIL/BLOCKED counts
per section, a link to every bug filed, and the commit SHA tested.
