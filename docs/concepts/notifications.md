---
title: Notifications
sidebar_position: 7
---

# Notifications

Routerly can send notifications when a budget limit is reached (or approaching a threshold). Notifications are delivered via one or more **channels** — email providers or webhooks.

---

## Configuring Notification Channels

Configure channels in **Dashboard → Settings → Notifications**, or by editing the `notifications` array in `settings.json`.

Each channel has:
- A `type` (the provider identifier)
- Connection settings specific to that provider
- A `name` label used in logs

After saving, use the **Send Test** button to verify the channel works before a real alert is triggered.

You can also test a channel via the API:

```bash
curl -X POST http://localhost:3000/api/notifications/test \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"channelName": "my-smtp"}'
```

---

## Channel Types

### SMTP

Sends email via any SMTP server. Routerly auto-detects whether to use SSL (port 465) or STARTTLS (port 587 / 25).

```jsonc
{
  "type": "smtp",
  "name": "my-smtp",
  "host": "smtp.example.com",
  "port": 587,
  "user": "alerts@example.com",
  "password": "secret",
  "from": "Routerly <alerts@example.com>",
  "to": "admin@example.com"
}
```

### Amazon SES

Uses Amazon SES via its regional SMTP endpoint. Authentication is the standard SES SMTP username + password (not your AWS credentials).

```jsonc
{
  "type": "ses",
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
  "type": "sendgrid",
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
  "type": "azure",
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
  "type": "google",
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
  "type": "webhook",
  "name": "slack-webhook",
  "url": "https://hooks.slack.com/services/xxx/yyy/zzz",
  "secret": "optional_signing_secret"
}
```

**Webhook payload:**
```json
{
  "event": "budget.exhausted",
  "budget": {
    "level": "project",
    "name": "my-app",
    "metric": "cost",
    "window": "monthly",
    "limit": 50.00,
    "current": 50.12
  },
  "timestamp": "2025-01-15T14:30:00Z"
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

Independently of external channels, every event is appended to a per-instance inbox persisted in `notifications.json` (retention: the last 200 events or 30 days, whichever is smaller). The dashboard shows a bell icon with an unread badge; each user tracks their own read state. The inbox is always available — even with zero external channels configured.

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
