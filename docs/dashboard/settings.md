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

## Notifications Tab {#notifications-tab}

Configure notification channels. Each channel routes events to a delivery method (in-app inbox, email, or webhook) and can be scoped to specific event types and recipients.

The Notifications tab provides a **channel management interface** with a full list of configured channels and options to create, edit, test, and delete them.

### Channel List

The list displays all configured channels in a table with:
- **Name** - friendly label
- **Type** - channel provider (Dashboard, SMTP, Slack, etc.)
- **Events** - event filter summary (shows first few patterns, `*` = all)
- **Targets** - target summary (role, permission, and user counts; empty = everyone)
- **Actions** - buttons to edit, test, and delete

Click a channel row to navigate to its **edit page** for detailed configuration.

### Adding a Channel

1. Click **+ Add Channel** (or navigate to **Settings > Notifications > New Channel**)
2. Select the channel type: `Dashboard`, `SMTP`, `SES`, `SendGrid`, `Azure`, `Google`, `Webhook`, `Slack`, `Teams`, `PagerDuty`, or `Discord`
3. Fill in the friendly **Name** and any required connection details:
   - **Dashboard**: name only (no credentials)
   - **Email providers** (SMTP, SES, SendGrid, Azure, Google): host, auth, from address
   - **Webhooks/Native** (Webhook, Slack, Teams, PagerDuty, Discord): integration URLs and keys
4. (Optional) Filter by **Events** - select specific event types to route to this channel; leave empty to receive all
5. (Optional) Set **Recipients / Targets** - pick roles, permissions, or individual users; leave empty for everyone
6. Click **Create Channel**
7. Use **Send Test** to verify the channel works before relying on it for real events

See [Concepts: Notifications](../concepts/notifications.md) for the full event taxonomy and per-type configuration fields.

:::note Target scope
**Recipients / Targets** control inbox visibility for the `Dashboard` channel and recipient resolution for email channels. Webhook and native channels (Slack, Teams, PagerDuty, Discord) deliver to a fixed endpoint - targets are stored but do not affect their delivery.
:::

### Editing a Channel

Click the channel row or the **Edit** button to open the edit page. You can change:
- **Name** - friendly label
- **Events** - event filter (leave empty for all)
- **Recipients / Targets** - audience filter
- **Connection details** - provider-specific fields (host, API keys, etc.). Secret fields (passwords, API keys, tokens) show as masked (`***`) when present; clearing the field will leave it unchanged. To update a secret, re-enter it in the text field.

After making changes, click **Update Channel** to save.

### Testing a Channel

On the channel list or edit page, click **Send Test**. Routerly sends a test message immediately. Check for a success toast or an error message with details about what went wrong.

For email-provider channels, you can optionally override the recipient email address before sending the test.

### Removing a Channel

Click the **Delete** button on the channel row or edit page. You will be asked to confirm deletion.

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
