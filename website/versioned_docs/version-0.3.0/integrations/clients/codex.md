---
title: Codex
sidebar_label: Codex
---

# Codex

[Codex](https://developers.openai.com/codex) is OpenAI's CLI coding agent.
It speaks the OpenAI wire format and reads its provider settings from a TOML
config file.

**Support state:** `auto-configurable`. `routerly clients configure` writes
this file for you.
**Config file:** `~/.codex/config.toml` (TOML)
**Wire format:** OpenAI

---

## Auto-configure (recommended)

With the [CLI](../../cli/commands.md#routerly-clients) installed and logged in:

```bash
routerly clients configure codex --project <your-project>
```

This mints a project token (or reuses one you pass with `--token`), backs
up your existing `~/.codex/config.toml`, and adds the block below. Any
other provider or setting already in the file is left untouched.

Minting a new token requires `project:write` permission on the target
project (use `--token <existing-token>` to skip this).

## Manual configuration

Open `~/.codex/config.toml` and add:

```toml
model_provider = "routerly"

[model_providers.routerly]
name = "Routerly"
base_url = "http://localhost:3000/v1"
wire_api = "responses"
experimental_bearer_token = "sk-rt-YOUR_PROJECT_TOKEN"
```

`base_url` includes the `/v1` suffix. Replace `http://localhost:3000/v1`
with your Routerly instance's URL and `sk-rt-YOUR_PROJECT_TOKEN` with a
project token (create one on the [Projects](../../dashboard/projects.md)
page, or let `clients configure` mint one for you).

## Undo

Every `configure` run prints a `Backup ID`. Restore the file to its exact
prior state with:

```bash
routerly clients undo <backupId>
```

See [CLI: `routerly clients`](../../cli/commands.md#routerly-clients) for the full command
reference, including `inspect` (check current status) and `doctor` (check
service reachability).
