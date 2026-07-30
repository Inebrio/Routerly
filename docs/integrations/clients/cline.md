---
title: Cline (auto-configure)
sidebar_label: Cline (auto-configure)
---

# Cline — auto-configure

This page documents Cline's support state under the `routerly clients`
CLI. For a general, manually-written walkthrough of pointing Cline at
Routerly, see [Integrations: Cline](../cline.md).

[Cline](https://github.com/cline/cline) is an autonomous coding agent that
runs inside VS Code. It speaks the OpenAI (or Anthropic) wire format.

**Support state:** `documented` — manual configuration only. Cline has **no
config file**; it stores its provider settings inside VS Code's own
extension state, reachable only through the extension's Settings UI. There
is nothing on disk this CLI can safely back up, edit, and restore, so Cline
is not auto-configurable.
**Config file:** none (VS Code Settings, Cline panel)
**Wire format:** OpenAI

---

## Why there's no auto-configure command

Both `routerly clients configure cline` and `routerly clients launch cline`
error out on purpose, pointing back to this page:

```bash
routerly clients configure cline --project <your-project>
```
```
Error: Cline is not auto-configurable: it is configured through the extension's settings UI (gear icon panel: Base URL / API Key / Model ID), not a standalone file this CLI can safely edit. See docs: integrations/clients/cline
```

`routerly clients inspect cline` still works — it best-effort detects
whether the Cline VS Code extension is installed, but cannot report whether
it is currently pointed at Routerly (there's no file to read).

## Manual configuration

1. Open the Cline extension panel in VS Code and click the **Settings** gear.
2. Set **API Provider** to `OpenAI Compatible`.
3. Fill in:
   - **Base URL** → `http://localhost:3000/v1`
   - **API Key** → `sk-rt-YOUR_PROJECT_TOKEN`
   - **Model** → any model registered in your Routerly project

Replace `http://localhost:3000/v1` with your Routerly instance's URL and
`sk-rt-YOUR_PROJECT_TOKEN` with a project token (create one on the
[Projects](../../dashboard/projects.md) page).

See [Integrations: Cline](../cline.md) for the Anthropic-mode variant and
usage notes, and [CLI: `routerly clients`](../../cli/commands.md#routerly-clients)
for the full command reference (`list`, `inspect`, `doctor`).
