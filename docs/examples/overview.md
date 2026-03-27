---
title: Examples
sidebar_label: Overview
sidebar_position: 1
---

# Examples

Ready-to-run code snippets for calling Routerly from any language. Every example connects to the same two endpoints:

| Protocol | Endpoint | When to use |
|----------|----------|-------------|
| **OpenAI** | `http://localhost:3000/v1/chat/completions` | Default — use with any OpenAI-compatible SDK |
| **Anthropic** | `http://localhost:3000/v1/messages` | Use with the Anthropic SDK or when targeting Claude models |

---

## Common pattern

Every integration needs two values:

- **Base URL** — `http://localhost:3000/v1` (OpenAI) or `http://localhost:3000` (Anthropic)
- **API Key** — your project token: `sk-lr-YOUR_PROJECT_TOKEN`

Change these two lines in your existing code and nothing else needs to change.

---

## Languages

| Language | OpenAI SDK | Anthropic SDK | Raw HTTP |
|----------|-----------|---------------|----------|
| [JavaScript / TypeScript](./javascript) | `openai` npm | `@anthropic-ai/sdk` npm | `fetch` |
| [Python](./python) | `openai` pip | `anthropic` pip | `httpx` |
| [Java](./java) | — | — | `java.net.http` |
| [Go](./go) | `go-openai` | — | `net/http` |
| [C# / .NET](./dotnet) | `Azure.AI.OpenAI` | — | `HttpClient` |
| [PHP](./php) | `openai-php/client` | — | `Guzzle` |
| [Ruby](./ruby) | `ruby-openai` gem | — | `Net::HTTP` |
| [Rust](./rust) | `async-openai` crate | — | `reqwest` |

---

## Getting a project token

Create a token in the dashboard: **Projects** → select your project → **Tokens** → **New Token**.

Tokens start with `sk-lr-` and are shown once. Copy it before closing the dialog.

---

## Next steps

- Read the full [LLM Proxy API reference](../api/llm-proxy) to see all supported request parameters.
- See [Integrations](../integrations/overview) for ready-made setup guides for tools like Cursor, Open WebUI, and LangChain.
