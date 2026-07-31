---
title: MCP Server
sidebar_position: 9
---

# MCP Server

Routerly's `mcp` module exposes the gateway's own management API as tools to
[Model Context Protocol](https://modelcontextprotocol.io/) clients: Claude
Code, Claude Desktop, and any other MCP-compatible client. It lets an agent
inspect and, for a small write-gated set of actions, adjust a Routerly
project directly from the conversation, without a human going through the
CLI or dashboard.

This is a distinct surface from the LLM Proxy (`/v1/*`, `/anthropic/*`):
`/mcp` never forwards a request to an upstream LLM provider. It only reads
and writes Routerly's own configuration and usage data.

---

## Transports

Two transports are shipped, both authenticated by a project token:

| Transport | Endpoint | Use case |
|-----------|----------|----------|
| **Streamable HTTP** | `POST /mcp` | Remote MCP clients, JSON-RPC 2.0 over HTTP |
| **stdio** | `routerly mcp serve` | Local desktop clients (Claude Desktop and similar) that spawn a subprocess and speak MCP over its stdin/stdout |

The stdio transport is a local wrapper: `routerly mcp serve` mints (or
accepts) a project token, then spawns the Routerly service binary with
`ROUTERLY_MCP_STDIO=1` and `ROUTERLY_MCP_TOKEN=<token>` set, which starts
only the stdio server on that token's identity. See
[CLI: `routerly mcp`](../cli/commands.md#routerly-mcp) and
[Reference: Environment Variables](../reference/environment-variables.md#mcp-server-variables).

Both transports run the exact same tool registry and the exact same
scope/permission checks, so a tool call behaves identically whichever
transport it arrives on.

---

## Authentication and scopes

The `/mcp` protocol surface (both transports) is authenticated by a
**project token**, the same `sk-rt-…` tokens used for the LLM Proxy. Two
scopes gate access:

| Scope | Required for |
|-------|--------------|
| `mcp` | Connecting to `/mcp` or the stdio transport at all, including every tool call. Without it: `403` on HTTP, a startup error on stdio. |
| `mcp:write` | Calling either of the 2 write tools (`create_project_token`, `toggle_model`). Without it: the tool call itself fails with an `isError` result, the read tools still work. |

Set these scopes when creating or editing a project token:

```bash
routerly project token create <project> --scopes mcp,mcp:write
```

or from the dashboard's token create/edit pages, see
[Dashboard: Projects: Tokens](../dashboard/projects.md#tokens-tab), field
**Scopes**.

A token without the `mcp` scope cannot reach `/mcp` at all, regardless of
any other permission or role it may carry: scopes are a property of the
token, not of the dashboard user who created it.

---

## Dashboard/service permissions

Separately from the token-scope gate above, the **management surface**
(`GET /api/mcp/tools`, the dashboard's MCP Tools page) is gated by ordinary
dashboard RBAC permissions:

| Permission | Grants |
|------------|--------|
| `mcp:read` | View `GET /api/mcp/tools` and the dashboard's [MCP Tools page](../dashboard/mcp.md) |
| `mcp:manage` | Reserved for a future per-tool enable/disable feature. **No route enforces it today**; granting it has no effect yet. |

`viewer` and `operator` built-in roles include `mcp:read`. See
[Dashboard: Users & Roles](../dashboard/users-and-roles.md).

---

## The built-in tools

Routerly ships 9 built-in tools, split into 7 read tools and 2 write tools
(`mcp:write`-gated). A tool only appears in the registry when its backing
module is bootstrapped: for example `get_metrics_snapshot` is absent if the
observability module isn't running on that instance.

### Read tools

| Tool | Does |
|------|------|
| `list_models` | Lists the models configured on the gateway (id, provider, context window). No secrets. |
| `get_model` | Gets one configured model by id. No secrets. |
| `route_preview` | Previews which model(s) the calling project would route a request to (ordered candidates + trace), no upstream call. |
| `get_usage_summary` | Summarizes the calling project's usage over a trailing window (default 24h): call count, cost, tokens. |
| `get_budget_status` | Reports current budget/limit usage per model for the calling project. |
| `get_metrics_snapshot` | Aggregate request/token/cost/latency metrics, scoped to the calling project only. |
| `list_projects` | Lists the project the calling token belongs to (only that one project, never a cross-project listing). |

### Write tools (require `mcp:write`)

| Tool | Does |
|------|------|
| `create_project_token` | Mints a new API token on the calling project. Returns only `id`/`tokenSnippet`/`createdAt`/`scopes`; the raw token value is never returned to the MCP client. |
| `toggle_model` | Flips the `enabled` flag on one of the calling project's model refs. The flag is persisted but not yet honored by the routing engine. |

Every tool is scoped to the calling project (from the auth token); no tool
can read or write another project's data.

---

## Related

- [Service: MCP Server](../service/endpoints.md#mcp-server): the `/mcp` HTTP endpoint reference
- [API: Management: MCP Tools](../api/management.md#mcp-tools): `GET /api/mcp/tools`
- [CLI: `routerly mcp`](../cli/commands.md#routerly-mcp): `tools`, `test`, `serve`
- [Dashboard: MCP Tools](../dashboard/mcp.md): the tool-browser page
