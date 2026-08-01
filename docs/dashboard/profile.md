---
title: Profile
sidebar_position: 10
---

# Dashboard: Profile

The Profile page lets each logged-in user manage their own account settings, their personal notification inbox, and the MCP tokens that let an AI client act on their behalf. Access it by clicking your email address in the sidebar (bottom-left of the screen).

![My Profile page showing Profile and Notifications tabs](../assets/screenshot-profile.png)

---

## Profile Tab

### Changing Your Password

1. Enter your **Current Password**
2. Enter your **New Password** (minimum 8 characters)
3. Re-enter the new password in **Confirm New Password**
4. Click **Change Password**

Routerly hashes passwords with bcrypt. Your current session remains active after a password change.

### Two-Factor Authentication

Enable TOTP-based 2FA under the **Two-Factor Authentication** section.

![Two-Factor Authentication setup panel showing the scannable QR code](../assets/screenshot-profile-2fa.png)

When you click **Enable Two-Factor Authentication**, the setup panel renders a scannable **QR code image** generated directly from the `otpauth://` URI. Open any TOTP authenticator app (Google Authenticator, Authy, 1Password, etc.) and scan the QR code. If your app does not support camera scanning, the underlying setup key (base32 secret) is still shown below the image so you can enter it manually.

Enter the 6-digit code from your authenticator app to confirm setup. Once enabled, you will be prompted for a TOTP code on every login.

### Account Information

The profile card shows your **email address** and your **role**.

---

## Notifications Tab {#notifications-tab}

The Notifications tab is your personal in-app notification inbox.

![Profile Notifications tab showing the in-app inbox](../assets/screenshot-profile-notifications.png)

It shows all notification events routed to you via any `dashboard` channel that includes you in its targets (or all events when no targeting is configured). Items are listed newest-first and include the event type, severity icon, and age.

### Filtering the Inbox

The inbox supports several filters to help you find relevant notifications:

- **Severity** - `All`, `Info`, `Warning`, or `Critical`
- **Event** - text search on event name (case-insensitive)
- **Date range** - pick a start and end date; date-only values span the full day

Filters work in combination: applying multiple filters shows only items matching all of them.

### Table and Row Selection

Each row shows the event type, severity color-coded, timestamp, and a brief detail summary. Click a row to open the **notification detail drawer** (see below).

Use the checkbox column to select multiple notifications. A **bulk action bar** appears when one or more items are selected, with options to:
- **Mark as Read** - marks selected items as read
- **Mark as Unread** - marks selected items as unread
- **Delete** - dismisses selected items from your inbox

### Notification Detail Drawer

Click on a notification row to open a detail drawer showing:
- Full **Event ID**
- **Event** type and **Severity**
- **Timestamp** (ISO 8601 with full precision)
- **Status** - read or unread with a toggle button
- Complete **Details** object (JSON formatted)
- **Delete** button to dismiss this item

Press **Esc** to close the drawer without saving changes.

The drawer's read/unread toggle is synced immediately to the server - you don't need to manually save.

### Unread Badge

The notification bell icon next to your email address in the sidebar shows an unread count badge when new items arrive. Click the bell icon to open a quick-view popup showing the latest few notifications. Navigate to the **Notifications** tab here for the full inbox.

### Marking as Read

Items are marked as read when you click them in the detail drawer. Use the bulk action bar to mark multiple items at once, or use the API endpoint `POST /api/notifications/inbox/read` with `{ "all": true }` to mark all as read programmatically. CLI: `routerly notification read`.

### Dismissing Notifications

Use the **Delete** button in the detail drawer or the bulk action bar **Delete** option (API: `POST /api/notifications/inbox/delete`, CLI: `routerly notification delete`). Dismissal is **per-user only** - other users' copies of the same notification remain in their inboxes unless they also dismiss it. There is no global delete: an item dismissed by one user is never removed from anyone else's inbox.

---

## MCP Tab {#mcp-tab}

The MCP tab is where you manage your own [MCP](../concepts/mcp.md) tokens and
see what an MCP client connected with them would be able to do. It is
reachable directly at `/dashboard/profile/mcp`.

An MCP token acts as you: it grants exactly the permissions of your role, and
nothing another user does affects it. Every user has this tab, with no extra
permission needed.

### MCP Tokens

The list shows one card per token, with its name, the visible prefix of the
value (`sk-rt-mcp-…`, the rest is never stored in clear), and **Created**,
**Last used**, and **Expires** (`Never` when the token has no expiry or has
never been used).

To create one:

1. Click **+ New Token**
2. Enter a **Name** (e.g. `laptop`, `desktop`, `ci`), unique among your tokens
3. Optionally pick an **Expires on** date; leave it empty for a token that
   never expires
4. Click **Create token**

The raw value appears once, in a highlighted box with a **Copy** button.
Copy it before dismissing the box: Routerly stores only its SHA-256 hash and
cannot show it again. Losing it means creating a new token.

The trash icon revokes a token after a confirmation. Revocation is immediate:
any client using that token stops working on its next call.

### Tools Your Tokens Expose

A table of every tool an MCP client of yours can call: **Name**, **Scope**
(`read` or `write`), **Description**, **Source module**, and the
**Permission** that gates it. The list is filtered by your role, so it is
exactly what your tokens expose, not the gateway's full catalogue. A role
without any of the tool permissions sees an empty state here.

### Connect an MCP Client

The last section gives the two ways to connect:

- **stdio (local)**: run `routerly mcp serve`, which passes your token to the
  service. Running the service binary directly instead means setting
  `ROUTERLY_MCP_STDIO=1` and `ROUTERLY_MCP_TOKEN=<your MCP token>` yourself.
- **HTTP (remote)**: JSON-RPC 2.0 over Streamable HTTP at this instance's
  `/mcp` endpoint, authenticated with
  `Authorization: Bearer <your MCP token>`.

For the exact configuration each client expects, see
[Guides: Connect an MCP client](../guides/mcp-clients.md).

---

## Navigation

Access the Profile page from the sidebar: click your email address (bottom-left of the sidebar, above Settings).
