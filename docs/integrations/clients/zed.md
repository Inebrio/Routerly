---
title: Zed
sidebar_label: Zed
---

# Zed

[Zed](https://zed.dev) is a high-performance editor with a built-in AI
agent. It reads OpenAI-compatible providers from its own `settings.json`,
and keeps API keys out of that file: they live in the system keychain or in
an environment variable.

**Support state:** `documented`. Configured by hand.
**Config file:** `~/.config/zed/settings.json` (JSON)
**Wire format:** OpenAI
**Connect modes:** LLM + MCP

Zed is not auto-configured by the CLI: the settings file is one users edit
constantly by hand, and the API key does not belong in it at all.

---

## Print the steps

```bash
routerly clients configure zed --project my-api
```

Prints the block below with a real project token, mints one if you do not
pass `--token`, and writes nothing. The dashboard shows the same block
under **Connect → Zed**, with a placeholder in place of the token.

## Configure

Open `~/.config/zed/settings.json` (**Zed → Settings → Open Settings**) and
merge in:

```json
{
  "language_models": {
    "openai_compatible": {
      "Routerly": {
        "api_url": "http://localhost:3000/v1",
        "available_models": [
          {
            "name": "routerly/ada",
            "display_name": "Routerly (auto-routed)",
            "max_tokens": 128000
          }
        ]
      }
    }
  }
}
```

Replace `http://localhost:3000/v1` with your instance's URL. The `/v1`
suffix is part of `api_url`.

`routerly/ada` is the auto-routing model: Routerly picks the target model
per request. Add more entries to `available_models` if you want to address
a specific model registered in your project.

## Add the API key

Zed never stores provider keys in `settings.json`. Either:

- **Agent panel**: open the assistant, **Settings → Providers → Routerly**,
  paste the project token. Zed stores it in the system keychain.
- **Environment**: export `OPENAI_API_KEY=sk-rt-YOUR_PROJECT_TOKEN` before
  launching Zed from a shell.

Create a project token on the [Projects](../../dashboard/projects.md) page,
or let `routerly clients configure zed` mint one for you.

## Verify

Pick **Routerly (auto-routed)** in the agent's model picker and send a
message. The request shows up in [Usage](../../dashboard/usage.md) with the
model Routerly selected.

## MCP server

Zed calls MCP servers **context servers**, configured in the same
`settings.json`:

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
tokens. That token is a personal MCP token (`sk-rt-mcp-…`), not a project
token: create one with `routerly mcp token create zed` or from
**Profile → MCP** in the dashboard. See
[Connect an MCP client](../../guides/mcp-clients.md#zed).
