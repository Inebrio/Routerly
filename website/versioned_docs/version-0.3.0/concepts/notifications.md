---
title: Notifications
sidebar_position: 7
---

# Notifications

Routerly emits events when something notable happens — a provider goes down, a budget limit is hit, a login fails. These events are routed to one or more **channels**: the in-app inbox, email providers, or webhooks.

Every channel supports two filtering dimensions:

- **Events** — which event types it receives. Leave empty to receive all events.
- **Targets** — who receives them (`{ roles, permissions, users }`). Leave empty for everyone.

---

## Channel Types

### Dashboard (in-app inbox)

The `dashboard` channel routes events to the per-user in-app inbox. No credentials are required. The inbox is always available regardless of other channels.

```jsonc
{
  "provider": "dashboard",
  "name": "Budget Alerts",
  "events": ["budget.*"],
  "targets": { "roles": ["admin"] }
}
```

Targets control **inbox visibility**: only matched users see the item in their inbox. If `targets` is omitted, all users see the item.

:::note
Webhook and native channels (Slack, Teams, PagerDuty, Discord) deliver to a fixed endpoint, so `targets` does not change delivery for those types — it is documented on the channel but has no effect. Only the `dashboard` channel and email channels use targets for recipient resolution.
:::

### SMTP

Sends email via any SMTP server. Routerly auto-detects whether to use SSL (port 465) or STARTTLS (port 587 / 25).

```jsonc
{
  "provider": "smtp",
  "name": "my-smtp",
  "host": "smtp.example.com",
  "port": 587,
  "user": "alerts@example.com",
  "password": "secret",
  "from": "Routerly <alerts@example.com>",
  "to": "admin@example.com",
  "events": ["provider.error", "provider.degraded"],
  "targets": { "roles": ["admin", "operator"] }
}
```

For SMTP and other email channels, `targets` controls **recipient resolution**: Routerly looks up matching users and adds their email addresses to the `to` field in addition to any static `to` value.

### Amazon SES

Uses Amazon SES via its regional SMTP endpoint. Authentication is the standard SES SMTP username + password (not your AWS credentials).

```jsonc
{
  "provider": "ses",
  "name": "ses-us-east",
  "region": "us-east-1",
  "user": "AKIAIOSFODNN7EXAMPLE",
  "password": "ses_smtp_password",
  "from": "alerts@example.com",
  "to": "admin@example.com"
}
```

### SendGrid

Uses SendGrid's SMTP relay at `smtp.sendgrid.net:587`. The username is always `apikey` and the password is your SendGrid API key.

```jsonc
{
  "provider": "sendgrid",
  "name": "sendgrid",
  "apiKey": "SG.xxxx",
  "from": "alerts@example.com",
  "to": "admin@example.com"
}
```

### Azure Communication Services

Sends email via Azure Communication Services. Authentication uses HMAC-SHA256 with your connection string's access key.

```jsonc
{
  "provider": "azure",
  "name": "azure-email",
  "connectionString": "endpoint=https://....communication.azure.com;accesskey=BASE64KEY==",
  "from": "alerts@yourdomain.com",
  "to": "admin@example.com"
}
```

### Google (Gmail / Google Workspace)

Uses the Gmail API via OAuth 2.0. Requires a Google Cloud project with the Gmail API enabled and a refresh token.

```jsonc
{
  "provider": "google",
  "name": "gmail",
  "clientId": "123456789.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-xxxx",
  "refreshToken": "1//xxxx",
  "from": "alerts@gmail.com",
  "to": "admin@example.com"
}
```

### Webhook

Sends an HTTP POST request to any URL. An optional HMAC-SHA256 signature is included in the `X-Routerly-Signature` header when a `secret` is configured.

```jsonc
{
  "provider": "webhook",
  "name": "ops-webhook",
  "url": "https://hooks.example.com/routerly",
  "secret": "optional_signing_secret",
  "events": ["provider.error", "routing.no_candidates"]
}
```

**Webhook payload:**
```json
{
  "event": "provider.error",
  "severity": "critical",
  "timestamp": "2025-01-15T14:30:00Z",
  "details": { "modelId": "openai/gpt-5" }
}
```

**Signature verification (Node.js):**
```javascript
import { createHmac } from 'crypto';

const signature = req.headers['x-routerly-signature'];
const body = req.rawBody; // raw request body as string
const expected = createHmac('sha256', secret).update(body).digest('hex');
const isValid = signature === `sha256=${expected}`;
```

### Slack / Teams / PagerDuty / Discord

Native integrations. Deliver to a fixed endpoint — `targets` is accepted but does not change delivery.

```jsonc
// Slack
{
  "provider": "slack",
  "name": "ops-alerts",
  "botToken": "xoxb-...",
  "channelId": "C1234567890"
}

// Microsoft Teams
{ "provider": "teams", "name": "teams-alerts", "webhookUrl": "https://..." }

// PagerDuty
{ "provider": "pagerduty", "name": "pagerduty", "integrationKey": "abc123" }

// Discord
{ "provider": "discord", "name": "discord", "webhookUrl": "https://..." }
```

---

## Notification Events

Every event carries the payload `{ event, severity, timestamp, details }`, where `severity` is one of `info`, `warning`, or `critical`.

| Event | Severity | Description |
|-------|----------|-------------|
| `budget.threshold` | warning | Budget reached the configured warning threshold (e.g. 80%) |
| `budget.exhausted` | critical | Budget reached its limit |
| `budget.reset` | info | Budget window reset (optional) |
| `provider.error` | critical | Non-retryable provider error (5xx, auth failure) |
| `provider.degraded` | warning | Error rate for a model exceeded the threshold in the window |
| `provider.recovered` | info | A previously degraded model is healthy again |
| `provider.rate_limited` | warning | 429 received; model entered cooldown |
| `routing.no_candidates` | critical | All models filtered out; request returned 503 |
| `routing.fallback_used` | info | Primary model skipped; a fallback was used |
| `auth.login_failed` | warning | A dashboard login failed for an existing user (wrong password) |
| `auth.token_invalid` | warning | A project token that does not exist was used |
| `config.model_added` / `config.model_deleted` | info | A model was created or deleted |
| `config.project_created` / `config.project_deleted` | info | A project was created or deleted |
| `system.startup` / `system.shutdown` | info | Service lifecycle |

---

## Configuring Channels

Configure channels in **Settings > Notifications** or directly in `settings.json` under `notifications.channels`. See [Dashboard: Settings](../dashboard/settings.md#notifications-tab) for the UI and [API: Notification Channels](../api/management.md#notification-channels) for the HTTP API.

After saving, use the **Send Test** button (or `POST /api/notifications/channels/:id/test`) to verify the channel works before a real event is triggered.

---

## Routing Rules

By default events are not dispatched to any external channel — they only land in the in-app inbox. To route events to channels, add `notificationRules` to the `notifications` config. Each rule maps event patterns to channel IDs.

```jsonc
{
  "notifications": {
    "channels": [ /* … */ ],
    "notificationRules": [
      { "events": ["provider.error", "provider.degraded"], "channels": ["webhook-ops"] },
      { "events": ["budget.*"], "channels": ["smtp-admin"] }
    ]
  }
}
```

Pattern matching supports an exact event name, the wildcard `*`, or a prefix glob such as `budget.*` (matches `budget.threshold`, `budget.exhausted`, …).

---

## Cooldowns

To avoid alert storms, configure a minimum interval between repeated dispatches of the same event type. Suppressed events are still recorded in the inbox and logged — they are simply not dispatched to external channels.

```jsonc
{
  "notifications": {
    "cooldowns": { "provider.degraded": "15m", "budget.threshold": "1h" }
  }
}
```

Durations accept `s`, `m`, `h`, `d` suffixes. Cooldown state is held in memory (single-node).

---

## In-App Inbox

Independently of external channels, every event matching a `dashboard` channel's `events` filter (or all events when no `dashboard` channel is configured) is appended to the inbox, persisted in `notifications.json`. Retention: last 200 events or 30 days, whichever is smaller.

The inbox is **per-user**: each user sees only items addressed to them (matched by the `targets` of the `dashboard` channel that created the item, or all items when no targeting is configured). Each user independently:

- Marks items as read or unread (tracked per-user)
- Dismisses (deletes) items - removal is **per-user only**, never global. Other users' copies of the same notification remain in their inboxes unless they also dismiss it.

Users access their inbox via the notification bell on the profile row in the sidebar, or the full **Notifications** tab under **My Profile** (`/dashboard/profile/notifications`).

### Filtering and Pagination

The inbox supports filtering by:
- **Severity** - `info`, `warning`, or `critical`
- **Event** - substring match (case-insensitive) on event name
- **Date range** - `from` and `to` (YYYY-MM-DD or ISO 8601); date-only values span the full day
- **Read status** - `unreadOnly` to show only unread items

Results are newest-first. The API supports both flat-list mode (for dropdown bells) and server-side pagination (for the full inbox page).

See the [Management API](../api/management.md#notifications-inbox) for the inbox endpoints.

---

## Per-Project Recipients

A project can override which channels its own events go to by setting `notifications.channels` on the project. These channel IDs are merged with the global `notificationRules` matches for events emitted in that project's context.

```jsonc
// projects.json — one project entry
{
  "id": "proj_123",
  "name": "Acme",
  "notifications": { "channels": ["webhook-acme"] }
}
```
