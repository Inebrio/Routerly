---
title: Claude Desktop
sidebar_label: Claude Desktop
---

# Claude Desktop

[Claude Desktop](https://claude.ai/download) is Anthropic's desktop app. It
talks to Anthropic's own backend and exposes no base-URL override, so its
chat traffic **cannot** be routed through Routerly. What it can do is load
Routerly as an MCP server, which gives Claude your gateway's tools:
routers, models, usage, routing.

**Support state:** `documented`. Configured by hand.
**Config file:** `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
**Connect modes:** MCP only

---

## Print the steps

```bash
routerly clients configure claude-desktop
```

The command writes nothing for this client: it prints the JSON block below
and the command that mints the token. The same block is shown in the
dashboard under **Connect → Claude Desktop**.

## Create an MCP token

MCP tokens are personal, not per router:

```bash
routerly mcp token create --label claude-desktop
```

The token (`sk-rt-mcp-…`) is shown once. You can also create it from
**Profile → MCP** in the dashboard.

## Configure

Open the config file from the app (**Settings → Developer → Edit Config**)
and add the `routerly` entry:

```json
{
  "mcpServers": {
    "routerly": {
      "command": "routerly",
      "args": ["mcp", "serve"],
      "env": {
        "ROUTERLY_MCP_TOKEN": "sk-rt-mcp-YOUR_TOKEN"
      }
    }
  }
}
```

`routerly mcp serve` reads the token from `ROUTERLY_MCP_TOKEN`, so the app
needs no CLI login of its own. If the app cannot find the binary, use the
absolute path from `which routerly` as `command`.

Restart Claude Desktop. The tools appear under **Connectors**, filtered by
the permissions of the user who owns the token.

## Routing the chat itself

Not possible today. To send Claude-style traffic through Routerly, use
[Claude Code](./claude-code.md) or any
[Anthropic SDK app](../generic-anthropic.md), both of which honour
`ANTHROPIC_BASE_URL`.

See also: [MCP clients guide](../../guides/mcp-clients.md),
[MCP concepts](../../concepts/mcp.md).
