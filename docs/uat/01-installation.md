# 01 - Installation and upgrade

Installer (`scripts/install.sh` -> `scripts/install.mjs`), service lifecycle and upgrade. Runs on the `uat-clean` snapshot of the uat-box (Debian 12). Surfaces: installer and CLI; the dashboard is only the first-run check.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-01-01 - Fresh install with the official script
**Surfaces:** cli
**Preconditions:** uat-box rolled back to `uat-clean`; no Node.js installed
**Steps:**
1. Pipe `scripts/install.sh` to the uat-box shell (`ssh root@<host> 'bash -s' < scripts/install.sh`), answering the Node.js prompt over a tty.
2. Run `routerly --version` and `systemctl is-active routerly`.
**Expected:** Installer completes with exit 0; `routerly --version` prints the target version; the service is `active`. Any prerequisite the installer needs but does not install or name (curl, sudo) is recorded as a finding.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-02 - Non-interactive install flags
**Surfaces:** cli
**Preconditions:** `uat-clean` snapshot
**Steps:**
1. Run the installer with `--yes --scope=system --port=3000 --no-cli`.
2. Check `ss -ltnp | grep 3000` and `ls /var/lib/routerly`.
**Expected:** Service listens on the requested port, data lives under `/var/lib/routerly`, the `routerly` CLI is not installed.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-03 - Config files are created with mode 0600
**Surfaces:** service
**Preconditions:** Fresh install completed, service started once
**Steps:**
1. `stat -c '%a %n' <data-dir>/config/*.json` (user scope: `~/.routerly`, system scope: `/var/lib/routerly`).
2. `journalctl -u routerly | grep -i permission`.
**Expected:** Every config file, including `settings.json`, is `600`; no permission warning in the service log; no permission banner in the dashboard.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-04 - First visit shows the setup page
**Surfaces:** dashboard
**Preconditions:** Fresh install without an admin user
**Steps:**
1. Open `http://<host>:3000/` in a browser.
2. `curl http://<host>:3000/api/setup/status`.
**Expected:** Dashboard shows the setup (first admin) page; `/api/setup/status` reports setup is needed.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-05 - Create the first admin
**Surfaces:** dashboard, service
**Preconditions:** Setup page visible
**Steps:**
1. Submit the setup form with an email and a valid password.
2. `curl -X POST /api/setup/first-admin` a second time.
**Expected:** First submit logs in or redirects to login and the admin can sign in; the second call is rejected and creates no second admin.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-06 - Service survives the end of the ssh session
**Surfaces:** cli
**Preconditions:** Service installed and running
**Steps:**
1. Close the ssh session used for install, wait 60 s, reconnect.
2. `systemctl is-active routerly` and open the dashboard.
**Expected:** Service is still active and the dashboard responds.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-07 - Service restarts after reboot
**Surfaces:** cli
**Preconditions:** Service installed, enabled
**Steps:**
1. `ssh root@192.168.1.7 'pct reboot 118'`, wait for ssh.
2. `systemctl is-active routerly`; `curl /api/setup/status`.
**Expected:** Service is active after boot without manual action; configuration and users are intact.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-08 - Update check and channel
**Surfaces:** cli, dashboard
**Preconditions:** Service running
**Steps:**
1. `routerly update check --json`.
2. `routerly update channel` then `routerly update channel next`.
3. Dashboard: Settings, update section.
**Expected:** `check` returns parseable JSON with current and latest version; channel change persists and is shown in the dashboard.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-09 - Upgrade from the previous release keeps data
**Surfaces:** cli, service
**Preconditions:** Previous release installed with a router, a user and usage data
**Steps:**
1. Run the installer (or `routerly update run --yes`) against the target ref.
2. `routerly status`, `routerly router list`, dashboard login.
**Expected:** Upgrade completes; service restarts; routers, users, connections and usage records are unchanged; `settings.json` is kept.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-01-10 - Migrations on first start of a newer version
**Surfaces:** service
**Preconditions:** A config directory written by an older version (legacy `projects.json`, `usage.json`, `models.json`)
**Steps:**
1. Start the service of the target version.
2. Inspect the data directory and the service log.
**Expected:** Legacy files are migrated to `routers.json`, `usage.ndjson`, connections/instances; the service starts; `models.json` is not deleted.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -
