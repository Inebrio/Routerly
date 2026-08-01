---
title: Integrations
sidebar_label: Overview
sidebar_position: 1
---

# Integrations

Routerly is compatible with any tool that speaks the OpenAI or Anthropic API. Point the tool at your Routerly instance, set your project token as the API key, and everything works — routing, budget enforcement, and cost tracking included.

---

## Chat UI

Chat interfaces that let you talk to your models directly.

| Tool | Description |
|------|-------------|
| [Open WebUI](./open-webui) | Full-featured chat UI with multi-model support |
| [OpenClaw](./openclaw) | Personal AI agent with Telegram, WhatsApp, Discord support |
| [LibreChat](./librechat) | Self-hosted open-source chat interface with multi-endpoint support |

---

## IDE & Editor

Native integrations for popular development environments.

| Tool | Description |
|------|-------------|
| [Cursor](./cursor) | AI-first code editor with inline completions and chat |
| [Continue.dev](./continue) | Open-source AI code assistant for VS Code and JetBrains |
| [Cline](./cline) | Autonomous coding agent with file and terminal access |
| [VS Code](./vscode) | GitHub Copilot-compatible AI coding assistant |

---

## Connect a client

Routerly keeps a registry of the AI clients it knows how to talk to. For
each one the `routerly clients` CLI command group either writes the config
file for you (with an automatic backup and undo) or prints the manual steps.
The dashboard shows the same steps, read-only, under
[Connect](../dashboard/connect.md).

**Modes**: `llm` means the client sends its model traffic through Routerly,
`mcp` means it loads Routerly as an MCP server and gets its tools.

| Client | Setup | Modes |
|--------|-------|-------|
| [Claude Code](./clients/claude-code) | CLI writes the config | llm + mcp |
| [Codex](./clients/codex) | CLI writes the config | llm + mcp |
| [OpenCode](./clients/opencode) | CLI writes the config | llm + mcp |
| [Continue.dev](./clients/continue) | CLI writes the config | llm |
| [Claude Desktop](./clients/claude-desktop) | Manual, MCP only | mcp |
| [OpenClaw](./openclaw) | Manual | llm + mcp |
| [Cline](./clients/cline) | Manual, VS Code Settings UI | llm |
| [Cursor](./cursor) | Manual, in-app Settings | llm |
| [Zed](./clients/zed) | Manual, `settings.json` | llm |
| [Any OpenAI SDK app](./generic-openai) | Manual, environment variables | llm |
| [Any Anthropic SDK app](./generic-anthropic) | Manual, environment variables | llm |

---

## Frameworks

AI application frameworks that call the OpenAI or Anthropic API.

| Tool | Description |
|------|-------------|
| [LangChain](./langchain) | Composable LLM application framework |
| [LlamaIndex](./llamaindex) | Data framework for LLM-powered applications |
| [Haystack](./haystack) | NLP and RAG pipeline framework |

---

## Automation

Workflow automation platforms with built-in AI nodes.

| Tool | Description |
|------|-------------|
| [n8n](./n8n) | Self-hostable workflow automation with an HTTP/AI node |
| [Make](./make) | Visual workflow automation with HTTP actions |

---

## Notebooks

Interactive computing environments.

| Tool | Description |
|------|-------------|
| [Jupyter](./jupyter) | Classic interactive notebook via the OpenAI Python SDK |
| [marimo](./marimo) | Reactive Python notebook with built-in AI cell support |

---

## How it works

Every integration follows the same two-step pattern:

1. **Set the base URL** to your Routerly instance — `http://localhost:3000/v1` for local, or your production URL.
2. **Set the API key** to your project token — `sk-rt-YOUR_PROJECT_TOKEN`.

Routerly looks like OpenAI or Anthropic to any client. No SDK patches, no plugins.

:::tip
If a tool asks for an **OpenAI API key** or **base URL**, those are the two fields to change.
For tools with an **Anthropic** mode, the base URL is `http://localhost:3000` (without `/v1`).
:::

---

## Not seeing your tool?

If a tool exposes a configurable OpenAI base URL, it will work with Routerly. Check the tool's documentation for terms like:

- *custom base URL*
- *API endpoint*
- *OpenAI-compatible*
- *self-hosted*
