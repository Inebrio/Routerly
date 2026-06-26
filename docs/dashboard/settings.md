---
title: Settings
sidebar_position: 7
---

# Dashboard: Settings

The Settings page allows admins to configure the Routerly service, notification channels, and view system information. It is only accessible to users with the `admin` role.

Open Settings from the **Settings** item in the sidebar.

---

## General Tab

### Service Configuration

| Field | Description |
|-------|-------------|
| **Port** | The port the service listens on (read-only — change via CLI or environment variable) |
| **Host** | The bind address (read-only) |
| **Public URL** | The externally accessible URL of this Routerly instance. Shown in project connection snippets |
| **Default Timeout** | Per-request timeout in milliseconds (applies to all projects unless overridden per-project) |
| **Log Level** | `trace` / `debug` / `info` / `warn` / `error` |
| **Dashboard Enabled** | Toggle the web dashboard on or off |

Changes are saved immediately and take effect without a restart (except Port and Host, which require a restart).

---

## Notifications Tab

Configure one or more notification channels for budget alerts.

### Adding a Channel

1. Click **+ Add Channel**
2. Select the channel type: `SMTP`, `SES`, `SendGrid`, `Azure`, `Google`, `Webhook`
3. Fill in the connection details for the selected type
4. Click **Save**
5. Click **Send Test** to verify the channel delivers a message correctly

See [Concepts: Notifications](../concepts/notifications.md) for the configuration fields required by each provider.

### Testing a Channel

Click **Send Test** next to a channel. Routerly sends a test message immediately. Check for a success toast or an error with details.

### Removing a Channel

Click the **Delete** icon next to a channel.

---

## About Tab

### Application

System information about the running instance:

| Field | Description |
|-------|-------------|
| **Version** | Routerly version string |
| **Channel** | Active update channel: `latest`, `stable`, `develop`, or a pinned version tag. Editable — see [Update Channel](#update-channel) below |
| **Uptime** | How long the service has been running since last start |
| **Node.js** | Node.js runtime version |
| **Platform** | OS and architecture |
| **Config Directory** | Path to `~/.routerly/config/` (or `$ROUTERLY_HOME/config/`) |

### Update Channel

The channel selector lets you choose which release stream Routerly follows when checking for updates:

| Channel | Description |
|---------|-------------|
| `latest` | Most recent release (may include pre-releases) |
| `stable` | Most recent production-stable release |
| `develop` | Development pre-release builds |
| Custom version | Pin to a specific release tag (e.g. `v0.2.0`) |

Changing the channel takes effect immediately — the running service is notified without a restart.

To enter a specific version tag, select **Custom…** in the dropdown. Type the tag (e.g. `v0.2.0`) and click **Apply**.

You can also change the channel from the CLI:

```bash
routerly update channel stable
routerly update channel v0.2.0
```

### Software Update

Shows the current update status for the active channel. The service checks for new releases automatically every 24 hours.

| Field | Description |
|-------|-------------|
| **Current version** | The version currently running |
| **Available version** | The latest version on the active channel, or "Up to date" if already current |
| **Last checked** | Timestamp of the most recent check against the GitHub Releases API |

**Check for updates** forces an immediate check against the GitHub Releases API and refreshes the displayed result.

**Update to vX.Y.Z** — visible only when a newer version is available on the current channel and the service is not running inside Docker. Clicking it triggers an in-app update:

1. The service downloads and runs the installer for the new version in the background
2. The service restarts automatically
3. The dashboard reloads once the service is back online (polled every 3 seconds, up to 60 seconds)

:::note Docker deployments
In-app update is disabled when Routerly is running inside a Docker container. Pull the new image and recreate the container instead:
```bash
docker pull inebrio/routerly:latest
docker compose up -d
```
:::

### Admin Update Banner

When a newer version is available on the active channel, a yellow banner appears at the top of every page for admin users. The banner links to this page and can be dismissed for the current browser session by clicking **×**.

---

## Audit Log

**Settings → Audit Log**

The Audit Log records every write operation performed on the Routerly instance: who did what, when, and whether it succeeded or was blocked.

### What is recorded

| Event | Trigger |
|-------|---------|
| `model:create/update/delete` | Model added, edited, or removed |
| `project:create/update/delete` | Project added, edited, or removed |
| `user:create/update/delete` | User added, edited, or removed |
| `role:create/update/delete` | Role added, edited, or removed |
| `token:create/delete` | API token issued or revoked |
| `settings:update` | Global settings changed |
| `forbidden` | Any action blocked by missing permission |

### Filters

- **Period** — date range picker with presets (today, last 7 days, this month, etc.)
- **User** — filter by email or user ID
- **Action** — filter by action substring (e.g. `model:create`)
- **Result** — toggle between All / Success / Forbidden / Error

Results are paginated (50 entries per page), server-side.

### Retention

Entries older than 90 days are automatically pruned. Maximum 10,000 entries are kept at any time.

### Access control

Requires `audit:read` permission. Assign this permission to roles that should have read-only access to the audit trail (e.g. a dedicated "Auditor" role).
