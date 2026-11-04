---
title: Installer testing and code backup
---

# Installer testing and code backup

## Test the installer only in a sandbox

Never run install or uninstall tests against the real machine. Use an isolated folder:

```bash
node scripts/install.mjs --yes --scope user --sandbox /tmp/rt-sandbox --source-dir <clean-source> --no-service --no-dashboard --public-url http://localhost:3000
```

`--sandbox <dir>` (or `ROUTERLY_INSTALL_SANDBOX`) moves home, app, data and bin under `<dir>`, and disables daemon, linger, telemetry and sudo. Only `--scope user` is allowed. The sandbox must be absolute, empty (or created by a previous sandbox run) and must not be, or contain, a real location (`/`, `/opt/routerly`, `/var/lib/routerly`, `/usr/local`, your home).

Test scripts set `ROUTERLY_INSTALL_TEST=1`: the installer then exits with an error unless `--sandbox` is given.

Independently of the sandbox, the installer refuses to copy into a folder that is not empty and is not a Routerly install (or that holds a `.git`). Uninstall removes only files listed in `.routerly-manifest`.

## Local backup of the working-code folder

`scripts/backup-code.sh [dest]` writes `code-<UTC>.tgz` (folders `code` and `worktrees` of `$CODE_ROOT`, default `/opt/routerly`, without `node_modules` and `dist`) to `/opt/routerly/backup/code`, outside the repository, and keeps the latest `$KEEP` (default 8). The dev-box runs it every 6 hours from `/etc/cron.d/routerly-code-backup` (copy of the script in `/usr/local/bin/routerly-code-backup`; log in `/opt/routerly/logs/code-backup.log`). Check freshness: `ls -lt /opt/routerly/backup/code | head -3`.

## Restore

```bash
scripts/restore-code.sh /opt/routerly/backup/code/code-<stamp>.tgz /tmp/restore-test
```

The destination must be empty; nothing is overwritten. To restore for real, extract into an empty folder, move `code` and `worktrees` to `/opt/routerly`, then run `git -C /opt/routerly/code worktree repair` and `npm ci` in the folders that need `node_modules`.
