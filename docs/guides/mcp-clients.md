---
title: Connect an MCP client
sidebar_label: MCP clients
sidebar_position: 3
---

# Connect an MCP client

Routerly exposes its own management API to MCP clients, so an agent can list
models, preview routing, read usage, and check budgets from inside a
conversation. See [Concepts: MCP Server](../concepts/mcp.md) for what the
surface is and which tools it ships.

This guide is the wiring: one section per client, with the exact command or
config file each one expects.

---

## 1. Create your MCP token

An MCP token is personal: it acts as you and grants exactly your role's
permissions. Create one from the CLI:

```bash
routerly mcp token create laptop
```

```
✓ MCP token "laptop" created.

Token (save it now, it is shown only once):
sk-rt-mcp-8f3c1d...
```

Or from the dashboard: **Profile → MCP → New Token**, which opens
`/dashboard/profile/mcp/new`. That page shows the value once and, right below
it, the configuration for the client you pick, with the token already in it
(see [Dashboard: Profile: MCP tab](../dashboard/profile.md#mcp-tab)).

Copy the value immediately: Routerly stores only its hash and never shows it
again. Revoke it at any time with `routerly mcp token remove <token-id>`, and
every client using it stops working on the next call.

---

## 2. Pick a transport

| Transport | Endpoint | When |
|-----------|----------|------|
| **HTTP** | `POST http://localhost:3000/mcp` | Anything that supports remote MCP servers. Preferred: no local CLI needed, and the token is checked on every request. |
| **stdio** | `routerly mcp serve` | Clients that only spawn a local subprocess, and setups where the gateway is not reachable over HTTP from the client. |

Replace `http://localhost:3000` with your own origin (`publicUrl`) if
Routerly does not run on the same machine as the client.

Verify the surface answers before wiring anything:

```bash
routerly mcp tools
routerly mcp test list_models
```

---

## Claude Code

HTTP, the one-liner:

```bash
claude mcp add --transport http routerly http://localhost:3000/mcp \
  --header "Authorization: Bearer sk-rt-mcp-YOUR_TOKEN"
```

stdio, if you prefer the local wrapper:

```bash
claude mcp add --transport stdio routerly -- routerly mcp serve
```

Everything after `--` is the command Claude Code runs, untouched.

Add `--scope user` to make the server available in every router instead of
just the current one, or `--scope router` to write it into the repository's
`.mcp.json` for the whole team. Check the result with:

```bash
claude mcp list
```

---

## Claude Desktop

Claude Desktop reads a JSON config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Open it from the app (**Settings → Developer → Edit Config**) and add the
`routerly` entry:

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

`routerly mcp serve` picks the token up from `ROUTERLY_MCP_TOKEN`, so the
desktop app needs no CLI login of its own.

Use an absolute path for `command` (`which routerly`) if the app cannot find
the binary: desktop apps do not inherit your shell's `PATH`. Quit and reopen
Claude Desktop to load the change; the tools then appear under **Connectors**.

---

## Codex

Codex CLI, HTTP:

```toml
# ~/.codex/config.toml
[mcp_servers.routerly]
url = "http://localhost:3000/mcp"
bearer_token_env_var = "ROUTERLY_MCP_TOKEN"
```

Codex reads the token from the named environment variable, so export it in
your shell profile:

```bash
export ROUTERLY_MCP_TOKEN="sk-rt-mcp-YOUR_TOKEN"
```

stdio, added from the command line:

```bash
codex mcp add routerly --env ROUTERLY_MCP_TOKEN=sk-rt-mcp-YOUR_TOKEN -- routerly mcp serve
```

which writes the equivalent `[mcp_servers.routerly]` section with `command`
and `args`.

---

## OpenCode

OpenCode reads `opencode.json` (router root, or `~/.config/opencode/opencode.json`
for every router). Remote:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "routerly": {
      "type": "remote",
      "url": "http://localhost:3000/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer sk-rt-mcp-YOUR_TOKEN"
      }
    }
  }
}
```

Local:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "routerly": {
      "type": "local",
      "command": ["routerly", "mcp", "serve"],
      "enabled": true,
      "environment": {
        "ROUTERLY_MCP_TOKEN": "sk-rt-mcp-YOUR_TOKEN"
      }
    }
  }
}
```

---

## OpenClaw

HTTP:

```bash
openclaw mcp add routerly \
  --url http://localhost:3000/mcp \
  --transport streamable-http \
  --header "Authorization: Bearer sk-rt-mcp-YOUR_TOKEN"
```

`--transport streamable-http` is required: OpenClaw defaults to `sse`, which
Routerly does not serve.

stdio:

```bash
openclaw mcp add routerly \
  --command routerly \
  --arg mcp \
  --arg serve \
  --env ROUTERLY_MCP_TOKEN=sk-rt-mcp-YOUR_TOKEN
```

Check the connection:

```bash
openclaw mcp probe routerly --json
```

---

## Cursor

Cursor reads `~/.cursor/mcp.json` for every router, or `.cursor/mcp.json`
inside a repository to scope the server to that router alone:

```json
{
  "mcpServers": {
    "routerly": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer sk-rt-mcp-YOUR_TOKEN"
      }
    }
  }
}
```

An entry with a `url` is remote by definition, so there is no transport field
to set. The server then appears under **Settings → Tools & Integrations →
MCP**, where it can be toggled per router.

---

## Cline

Cline keeps its servers in `~/.cline/mcp.json`, editable from the panel
(**MCP Servers → Configure MCP Servers**):

```json
{
  "mcpServers": {
    "routerly": {
      "type": "streamableHttp",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer sk-rt-mcp-YOUR_TOKEN"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

`"type": "streamableHttp"` is required: without it Cline falls back to the
legacy `sse` transport, which Routerly does not serve.

---

## Zed

Zed calls MCP servers **context servers**, configured in the same
`settings.json` as everything else (**Zed → Settings → Open Settings**):

```json
{
  "context_servers": {
    "routerly": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer sk-rt-mcp-YOUR_TOKEN"
      }
    }
  }
}
```

The `headers` entry is not optional: without it Zed starts an OAuth flow
against the server, and Routerly's MCP surface only authenticates bearer
tokens.

---

## Any other client

The surface is standard MCP, so any client that speaks Streamable HTTP works
with two values:

- **URL**: `http://localhost:3000/mcp`
- **Header**: `Authorization: Bearer sk-rt-mcp-YOUR_TOKEN`

A raw JSON-RPC call, to sanity-check a setup by hand:

```bash
curl -s http://localhost:3000/mcp \
  -H "Authorization: Bearer sk-rt-mcp-YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `401 Invalid MCP token.` | The token was revoked, mistyped, or is a router token (`sk-rt-…`) rather than an MCP token (`sk-rt-mcp-…`). |
| `401 MCP token expired.` | The token passed its expiry date. Create a new one. |
| Fewer tools than expected | `tools/list` only advertises the tools your role permits. Check your role in [Users & Roles](../dashboard/users-and-roles.md). |
| `Permission denied: … is required to call …` | Same cause, seen at call time instead of at listing time. |
| `routerId is required: this token can reach several routers` | Pass `routerId` in the tool arguments; it is optional only when you can reach exactly one router. |
| The client cannot start `routerly mcp serve` | The binary is not on the app's `PATH`. Use an absolute path in `command`. |

---

## Related

- [Concepts: MCP Server](../concepts/mcp.md): tokens, transports, permissions, and the full tool list
- [CLI: `routerly mcp`](../cli/commands.md#routerly-mcp): `tools`, `test`, `serve`, `token`
- [Dashboard: Profile: MCP tab](../dashboard/profile.md#mcp-tab): manage your tokens from the browser
