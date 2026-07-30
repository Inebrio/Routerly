---
title: Claude Code
sidebar_label: Claude Code
---

# Claude Code

[Claude Code](https://docs.claude.com/en/docs/claude-code) is Anthropic's
official CLI coding agent. It speaks the Anthropic Messages wire format and
reads its provider settings from a JSON config file.

**Support state:** `auto-configurable` — `routerly clients configure` writes
this file for you.
**Config file:** `~/.claude/settings.json` (JSON)
**Wire format:** Anthropic

---

## Auto-configure (recommended)

With the [CLI](../../cli/commands.md#routerly-clients) installed and logged in:

```bash
routerly clients configure claude-code --project <your-project>
```

This mints a project token (or reuses one you pass with `--token`), backs
up your existing `~/.claude/settings.json`, and merges in the `env` block
below — every other key already in the file is left untouched.

## Manual configuration

Open `~/.claude/settings.json` and merge in:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3000",
    "ANTHROPIC_AUTH_TOKEN": "sk-rt-YOUR_PROJECT_TOKEN"
  }
}
```

`ANTHROPIC_BASE_URL` has no `/v1` suffix — Claude Code talks to the root of
the Anthropic-compatible endpoint. Replace `http://localhost:3000` with your
Routerly instance's URL and `sk-rt-YOUR_PROJECT_TOKEN` with a project token
(create one on the [Projects](../../dashboard/projects.md) page, or let
`clients configure` mint one for you).

## Undo

Every `configure` run prints a `Backup ID`. Restore the file to its exact
prior state with:

```bash
routerly clients undo <backupId>
```

See [CLI: `routerly clients`](../../cli/commands.md#routerly-clients) for the full command
reference, including `inspect` (check current status) and `doctor` (check
service reachability).
