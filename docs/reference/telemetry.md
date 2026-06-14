---
title: Anonymous Telemetry
sidebar_position: 4
---

# Anonymous Telemetry

Routerly **never** sends any data automatically. Telemetry is strictly opt-in: nothing leaves your machine until you explicitly say yes, either during installation or from the dashboard/CLI at any time.

This page documents exactly what is sent, when, and why — so you can make an informed decision.

---

## Why telemetry exists

Routerly is self-hosted. That means we have no way to know how many instances are running, whether people are updating, or whether the installer works on different platforms — unless someone tells us.

The data collected helps answer one question: **is Routerly being used, and are upgrades reaching people?** That's it. No usage patterns, no model calls, no cost data, nothing about your workload.

---

## What is sent

A single HTTP `POST` request to `https://telemetry.routerly.ai/ping` with this JSON body:

```json
{
  "event":     "install",
  "version":   "0.2.0",
  "platform":  "linux",
  "installId": "a3f1c8b2d4e6..."
}
```

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `event` | string | `install` | One of `install`, `upgrade`, or `uninstall` |
| `version` | string | `0.2.0` | Routerly version being installed or running |
| `platform` | string | `linux` | OS platform: `linux`, `darwin`, or `win32` |
| `installId` | string | `a3f1c8b2...` | Random hex ID generated once at opt-in time |

**Nothing else is sent.** No hostname, no IP address logged server-side, no email, no project names, no model IDs, no usage data, no tokens.

The `installId` is a random string generated locally the moment you opt in. It has no relation to your identity — it exists only to deduplicate counts (so a single instance upgrading ten times is counted as one installation, not ten).

---

## When events are sent

| Event | When |
|-------|------|
| `install` | On the first service startup after opting in, when no previous ping has been recorded |
| `upgrade` | On service startup, when the running version differs from the last pinged version |
| `uninstall` | Once, just before the uninstaller removes your files, if you had previously opted in |

The service checks on every startup whether a ping is due (version changed or first run after opt-in). If telemetry is disabled or no version change is detected, nothing is sent.

Events are fire-and-forget with a 3-second timeout. If the request fails (network error, server down), Routerly continues normally — no retry, no error.

---

## What is NOT sent

- LLM requests, prompts, or completions
- Token counts or cost data
- Project names, model IDs, or API keys
- User email addresses or any account information
- Hostname, IP address, or any network identifier
- Usage statistics or performance metrics
- Anything from your `~/.routerly/` config directory

---

## Opt in

**During installation** — the installer asks once at the end:

```
Help improve Routerly? (completely optional)
Sends only: event type, version, platform, and a random ID.
No personal data. No IP stored. Opt out anytime:
  routerly telemetry off

Send anonymous install metrics? (yes/[no]):
```

The default is **no**. You must type `yes` to enable it.

**From the dashboard** — if you installed via Docker or another method that skipped the installer prompt, a one-time banner appears after your first login. Two explicit buttons: "Yes, help out" and "No thanks". Nothing is sent until you click one.

**From the CLI** at any time:

```bash
routerly telemetry on     # opt in
routerly telemetry off    # opt out
routerly telemetry status # check current setting
```

---

## Opt out

You can opt out at any time, even after opting in:

```bash
routerly telemetry off
```

This sets `telemetry.enabled: false` in your `settings.json` and stops all future pings immediately. No further data is sent after this point.

Telemetry is also automatically skipped when the environment variable `CI=true` is detected, so automated deployments and CI pipelines are never prompted and never send data.

---

## Where the setting is stored

The preference is stored in your local `settings.json` file:

```
~/.routerly/config/settings.json
```

```json
{
  "telemetry": {
    "enabled": true,
    "installId": "a3f1c8b2d4e6...",
    "lastPingedVersion": "0.2.1"
  }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | `true` if you have opted in, `false` or absent if not |
| `installId` | Random hex string generated once at opt-in time |
| `lastPingedVersion` | Version number of the last successful ping; used to detect upgrades on next startup |

If `telemetry` is absent from the file, Routerly has not asked you yet and no data has ever been sent.

---

## Server-side data handling

The telemetry endpoint receives the four fields listed above. IP addresses are not logged. The data is used only to maintain aggregate counts of active installations, upgrade adoption, and uninstalls.

No individual records are shared with third parties.
