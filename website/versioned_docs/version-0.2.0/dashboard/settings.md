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

Read-only system information:

| Field | Description |
|-------|-------------|
| **Version** | Routerly version string |
| **Uptime** | How long the service has been running since last start |
| **Node.js** | Node.js runtime version |
| **Platform** | OS and architecture |
| **Config Directory** | Path to `~/.routerly/config/` (or `$ROUTERLY_HOME/config/`) |
