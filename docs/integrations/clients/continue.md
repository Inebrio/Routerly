---
title: Continue (auto-configure)
sidebar_label: Continue (auto-configure)
---

# Continue: auto-configure

This page documents the `routerly clients configure continue` auto-apply
flow. For a general, manually-written walkthrough of pointing Continue at
Routerly (including an Anthropic-mode example), see
[Integrations: Continue.dev](../continue.md).

[Continue](https://continue.dev) is an open-source AI coding assistant for
VS Code and JetBrains. It speaks the OpenAI wire format and reads its
provider settings from a YAML config file.

**Support state:** `auto-configurable`. `routerly clients configure` writes
this file for you.
**Config file:** `~/.continue/config.yaml` (YAML)
**Wire format:** OpenAI

---

## Auto-configure (recommended)

With the [CLI](../../cli/commands.md#routerly-clients) installed and logged in:

```bash
routerly clients configure continue --router <your-router>
```

This mints a router token (or reuses one you pass with `--token`), backs
up your existing `~/.continue/config.yaml`, and appends a model entry to the
`models:` array. Any other entry already in the file is left untouched.

Minting a new token requires `router:write` permission on the target
router (use `--token <existing-token>` to skip this).

## Manual configuration

Open `~/.continue/config.yaml` and add an entry to `models:`:

```yaml
name: Routerly
version: 0.0.1
schema: v1

models:
  - name: Routerly (auto-routed)
    provider: openai
    model: routerly/ada
    apiBase: http://localhost:3000/v1
    apiKey: sk-rt-YOUR_ROUTER_TOKEN
```

`apiBase` includes the `/v1` suffix. `model: routerly/ada` is the
auto-routing sentinel: selecting it in Continue lets Routerly pick the
actual upstream model per request. Replace `http://localhost:3000/v1` with
your Routerly instance's URL and `sk-rt-YOUR_ROUTER_TOKEN` with a router
token (create one on the [Routers](../../dashboard/routers.md) page, or
let `clients configure` mint one for you).

## Undo

Every `configure` run prints a `Backup ID`. Restore the file to its exact
prior state with:

```bash
routerly clients undo <backupId>
```

See [CLI: `routerly clients`](../../cli/commands.md#routerly-clients) for the full command
reference, including `inspect` (check current status) and `doctor` (check
service reachability).
