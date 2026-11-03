---
title: MCP Server
sidebar_position: 9
---

# MCP Server

Routerly's `mcp` module exposes the gateway's own management API as tools to
[Model Context Protocol](https://modelcontextprotocol.io/) clients: Claude
Code, Claude Desktop, Codex, OpenCode, OpenClaw, Cursor, Cline, Zed, and any
other MCP-compatible client. It lets an agent inspect and, for a small write set, adjust Routerly
directly from the conversation, without a human going through the CLI or
dashboard.

This is a distinct surface from the LLM Proxy (`/v1/*`, `/anthropic/*`):
`/mcp` never forwards a request to an upstream LLM provider. It only reads
and writes Routerly's own configuration and usage data.

To wire a specific client to it, see
[Guides: Connect an MCP Client](../guides/mcp-clients.md).

---

## MCP is personal

An MCP token belongs to a **user**, not to a project. Connecting a client to
Routerly is the same act as logging into the dashboard: the client acts as
you, and it can do exactly what your role lets you do, no more.

| | |
|---|---|
| **Owner** | The user who created it. Each user manages their own tokens. |
| **Prefix** | `sk-rt-mcp-…`, distinct from the `sk-rt-…` project tokens used by the LLM Proxy. |
| **Storage** | SHA-256 hash only, on the owner's user record. The raw value is shown once at creation and is never retrievable afterwards. |
| **Grants** | Every permission of the owner's role, resolved at call time. Change the role, and every token of that user changes with it. |
| **Expiry** | Optional. An expired token is rejected with `401`, it is not deleted. |
| **Revocation** | Immediate: revoking a token stops every client using it on the next call. |

Create and revoke tokens from the dashboard's
[Profile: MCP tab](../dashboard/profile.md#mcp-tab) or with
[`routerly mcp token`](../cli/commands.md#routerly-mcp-token).

:::note Upgrading from an earlier version
Before 0.4.0, `/mcp` was authenticated by a **project token** carrying the
`mcp` and `mcp:write` scopes, and the tool browser was a gateway-wide page
gated by the `mcp:read` permission. Those scopes and the `mcp:read` /
`mcp:manage` permissions no longer exist: they are dropped from roles and
tokens automatically on first start after the upgrade. A client still
authenticating with a project token gets `401` and must be re-pointed at a
personal MCP token.
:::

---

## Transports

Two transports ship, both authenticated by the same personal MCP token:

| Transport | Endpoint | Use case |
|-----------|----------|----------|
| **Streamable HTTP** | `POST /mcp` | Remote MCP clients, JSON-RPC 2.0 over HTTP, `Authorization: Bearer sk-rt-mcp-…` |
| **stdio** | `routerly mcp serve` | Local desktop clients that spawn a subprocess and speak MCP over its stdin/stdout |

The stdio transport is a local wrapper: `routerly mcp serve` resolves an MCP
token, then spawns the Routerly service binary with `ROUTERLY_MCP_STDIO=1`
and `ROUTERLY_MCP_TOKEN=<token>` set, which starts only the stdio server on
that token owner's identity. See
[CLI: `routerly mcp`](../cli/commands.md#routerly-mcp) and
[Reference: Environment Variables](../reference/environment-variables.md#mcp-server-variables).

Both transports run the exact same tool registry and the exact same
permission checks, so a tool call behaves identically whichever transport it
arrives on. One difference of note: HTTP resolves the token on every request,
while stdio resolves it once at startup, so a role change reaches a running
stdio session only after a restart.

---

## Permissions

There is no MCP-specific permission. Each tool declares the ordinary
dashboard permission it needs, and the caller's role decides:

- `tools/list` returns only the tools the caller holds the permission for. A
  tool the caller cannot use is not advertised at all.
- `tools/call` re-checks the permission and returns an `isError` result,
  `Permission denied: <permission> is required to call <tool>.`, if it is
  missing. Filtering and enforcement are independent, so an under-permissioned
  client can never reach a handler.

An admin sees all 9 tools; a viewer sees only the read tools its role covers.
See [Dashboard: Users & Roles](../dashboard/users-and-roles.md) for the
permission catalogue.

### Project scope

Project-scoped tools take an optional `projectId` (id or name) and resolve it
against the projects the owner can reach: the user's assigned projects, plus
any project they are a member of, or every project when the user is scoped to
none. When exactly one project is reachable, `projectId` may be omitted. A
project outside that set is reported as not found, so it is
indistinguishable from one that does not exist.

---

## The built-in tools

Routerly ships 9 built-in tools, 7 read and 2 write. A tool only appears in
the registry when its backing module is bootstrapped: for example
`get_metrics_snapshot` is absent if the observability module is not running
on that instance.

### Read tools

| Tool | Permission | Does |
|------|------------|------|
| `list_models` | `model:read` | Lists the models configured on the gateway (id, provider, context window). No secrets. |
| `get_model` | `model:read` | Gets one configured model by id. No secrets. |
| `route_preview` | `project:read` | Previews which model(s) a project would route a request to (ordered candidates + trace), no upstream call. |
| `get_usage_summary` | `report:read` | Summarizes a project's usage over a trailing window (default 24h): call count, cost, tokens. |
| `get_budget_status` | `report:read` | Reports current budget/limit usage per model for a project. |
| `get_metrics_snapshot` | `report:read` | Aggregate request/token/cost/latency metrics for one project. Other projects' data is never returned. |
| `list_projects` | `project:read` | Lists the projects the token owner can reach (id, name, model count). |

### Write tools

| Tool | Permission | Does |
|------|------------|------|
| `create_project_token` | `token:write` | Mints a new API token on a project. Returns only `id`/`tokenSnippet`/`createdAt`/`scopes`; the raw token is never returned to the MCP client. |
| `toggle_model` | `project:write` | Flips the `enabled` flag on one of a project's model refs. The flag is persisted but not yet honored by the routing engine. |

---

## Errors

| Where | Condition | Result |
|-------|-----------|--------|
| HTTP | No `Authorization` header | `401` `Missing or invalid Authorization header. Expected: Bearer <mcp-token>` |
| HTTP | Unknown token, or a project token used by mistake | `401` `Invalid MCP token.` |
| HTTP | Token past its expiry | `401` `MCP token expired.` |
| stdio | `ROUTERLY_MCP_TOKEN` missing or rejected | The process fails to start, with the same message on stderr |
| Tool call | Caller lacks the tool's permission | `200` with `isError: true` in the JSON-RPC result |

---

## Related

- [Guides: Connect an MCP Client](../guides/mcp-clients.md): verified setup for Claude Code, Claude Desktop, Codex, OpenCode, OpenClaw, Cursor, Cline, and Zed
- [Dashboard: Profile: MCP tab](../dashboard/profile.md#mcp-tab): create, list, and revoke your tokens
- [CLI: `routerly mcp`](../cli/commands.md#routerly-mcp): `tools`, `test`, `serve`, `token`
- [Service: MCP Server](../service/endpoints.md#mcp-server): the `/mcp` HTTP endpoint reference
- [API: Management: Personal MCP Surface](../api/management.md#personal-mcp-surface): `/api/me/mcp-tools` and `/api/me/mcp-tokens`
