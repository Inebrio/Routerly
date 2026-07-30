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

## Auto-configure

Instead of copying a snippet by hand, the `routerly clients` CLI command
group writes a client's config file for you (with an automatic backup and
undo) or points you at the manual steps for clients with no config file.
See the [dashboard Clients page](../dashboard/clients.md) for a read-only,
copy-paste view of the same snippets.

| Client | Description |
|--------|-------------|
| [Claude Code](./clients/claude-code) | Anthropic's official CLI coding agent, auto-configurable |
| [Codex](./clients/codex) | OpenAI's CLI coding agent, auto-configurable |
| [OpenCode](./clients/opencode) | Open-source terminal coding agent, auto-configurable |
| [Continue.dev](./clients/continue) | `routerly clients configure continue`, auto-configurable |
| [Cline](./clients/cline) | VS Code Settings UI, manual only, no config file to auto-apply |

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
