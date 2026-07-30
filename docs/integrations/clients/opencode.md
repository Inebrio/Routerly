---
title: OpenCode
sidebar_label: OpenCode
---

# OpenCode

[OpenCode](https://opencode.ai) is an open-source terminal-based AI coding
agent. It speaks the OpenAI wire format and reads its provider settings from
a JSON config file.

**Support state:** `auto-configurable`. `routerly clients configure` writes
this file for you.
**Config file:** `~/.config/opencode/opencode.json` (JSON)
**Wire format:** OpenAI

---

## Auto-configure (recommended)

With the [CLI](../../cli/commands.md#routerly-clients) installed and logged in:

```bash
routerly clients configure opencode --project <your-project>
```

This mints a project token (or reuses one you pass with `--token`), backs
up your existing `~/.config/opencode/opencode.json`, and merges in a
`provider.routerly` entry. Any other provider already in the file is left
untouched.

## Manual configuration

Open `~/.config/opencode/opencode.json` and merge in:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "routerly": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Routerly",
      "options": {
        "baseURL": "http://localhost:3000/v1",
        "apiKey": "sk-rt-YOUR_PROJECT_TOKEN"
      },
      "models": {
        "routerly/ada": { "name": "Routerly (auto-routed)" }
      }
    }
  }
}
```

`baseURL` includes the `/v1` suffix. The provider ID is `routerly` (not
`opencode`) so it doesn't collide with OpenCode's built-in providers. The
single model entry `routerly/ada` is the auto-routing sentinel: selecting
it in OpenCode lets Routerly pick the actual upstream model per request.
Replace `http://localhost:3000/v1` with your Routerly instance's URL and
`sk-rt-YOUR_PROJECT_TOKEN` with a project token (create one on the
[Projects](../../dashboard/projects.md) page, or let `clients configure`
mint one for you).

## Undo

Every `configure` run prints a `Backup ID`. Restore the file to its exact
prior state with:

```bash
routerly clients undo <backupId>
```

See [CLI: `routerly clients`](../../cli/commands.md#routerly-clients) for the full command
reference, including `inspect` (check current status) and `doctor` (check
service reachability).
