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

The event name is the stable identifier: rules, cooldowns and filters all match on it. Alongside it, each event has a **title** and a **category** used by the dashboard and the CLI to display it. Categories are `routing`, `provider`, `budget`, `config`, `security` and `system`.

| Event | Category | Title | Severity | Description |
|-------|----------|-------|----------|-------------|
| `provider.error` | provider | Provider call failed | warning | The provider rejected the call or timed out; the provider's own message is kept in `details.error` |
| `provider.degraded` | provider | Provider degraded | warning | Consecutive failures for a model crossed the threshold |
| `provider.recovered` | provider | Provider recovered | info | A previously degraded model is healthy again |
| `provider.rate_limited` | provider | Provider rate limited | warning | 429 received; model entered cooldown |
| `routing.no_candidates` | routing | No model could serve the request | critical | All models filtered out; request returned 503 |
| `routing.fallback_used` | routing | Fallback model used | info | Primary model skipped; a fallback was used |
| `budget.threshold_reached` | budget | Budget threshold reached | warning | Budget reached its warning threshold (80% of a limit) |
| `budget.exceeded` | budget | Budget exhausted | critical | Budget reached its limit |
| `budget.reset` | budget | Budget period reset | info | Budget window reset |
| `auth.login_failed` | security | Failed sign-in | warning | A dashboard login failed for an existing user (wrong password) |
| `auth.token_invalid` | security | Invalid API token | warning | A router token that does not exist, or has expired, was used |
| `config.model_added` / `config.model_deleted` | config | Model added / Model deleted | info | A model was created or deleted |
| `config.router_created` / `config.router_deleted` | config | Router created / Router deleted | info | A router was created or deleted |
| `system.startup` / `system.shutdown` | system | Service started / Service stopped | info | Service lifecycle |
| `system.update_available` | system | A newer release is available | info | The update checker found a release newer than the one running on the configured channel; `details` carries `currentVersion`, `latestVersion`, `channel` and, when known, `releaseUrl`. Raised once per distinct release/channel/version combination, not on every scheduled check |

An event that is not in this table still displays: its title is derived from the name (`cache.purged` reads as "Cache purged") and its category comes from the prefix.

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

The inbox is **per-user**. Three gates decide whether an item reaches a given user:

1. **Audience** - the `targets` of the `dashboard` channel that created the item (no targeting means everyone).
2. **Permissions** - sign-in events need `audit:read`, model events `model:read`, router events `router:read`, service lifecycle events `settings:read`. Operational events (routing, provider, budget) are not gated.
3. **Routers** - an item about a router is hidden from users who cannot reach that router (scoped by `routerIds` or by membership). Users without a router scope see everything.

Each user independently:

- Marks items as read or unread (tracked per-user)
- Archives items - removal is **per-user only**, never global. Other users' copies of the same notification remain in their inboxes unless they also archive it.

Users access their inbox via the notification bell on the profile row in the sidebar, or the full **Notifications** tab under **My Profile** (`/dashboard/profile/notifications`).

### Correlated Incidents

Events emitted while serving the same request share a trace id. The inbox folds them into a single item carrying `traceId`, `eventCount` and, on the detail endpoint, the full `events` sequence. A request that fell back twice before failing is one incident in the list, not three lines. The detail view (dashboard drawer, `routerly notification show`) shows the sequence in the order it happened.

### Reading an Item

The list shows the title with the event name underneath. The detail view adds the **cause**: one line built from the item's details, ending with the provider's own error message when there is one, for example `ollama/qwen2.5:3b on ollama - TTFT timeout after 3000ms`.

Ids in the details are links in the dashboard: `routerId` opens the router, `modelId` (also `primaryModelId` and `fallbackModelId`) opens the model, `traceId` opens the matching record in Usage.

### Filtering and Pagination

The inbox supports filtering by:
- **Severity** - `info`, `warning`, or `critical`
- **Category** - `routing`, `provider`, `budget`, `config`, `security`, `system`
- **Event** - substring match (case-insensitive) on event name
- **Date range** - `from` and `to` (YYYY-MM-DD or ISO 8601); date-only values span the full day
- **Read status** - `unreadOnly` to show only unread items

Results are newest-first. The API supports both flat-list mode (for dropdown bells) and server-side pagination (for the full inbox page).

See the [Management API](../api/management.md#notifications-inbox) for the inbox endpoints.

---

## Per-Router Recipients

A router can override which channels its own events go to by setting `notifications.channels` on the router. These channel IDs are merged with the global `notificationRules` matches for events emitted in that router's context.

```jsonc
// routers.json — one router entry
{
  "id": "3f1c9e0a-7b2d-4e5f-9a6c-1d2e3f4a5b6c",
  "name": "Acme",
  "notifications": { "channels": ["webhook-acme"] }
}
```
