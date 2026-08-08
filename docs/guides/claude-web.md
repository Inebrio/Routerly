---
title: Use Claude via browser session
sidebar_label: Claude (browser session)
sidebar_position: 5
---

# Use Claude via browser session (anthropic-web)

The `anthropic-web` provider lets you route requests through your existing Claude Pro/Max account using your browser session cookie, without a separate Anthropic API key.

:::warning Unofficial adapter
This provider uses an internal, undocumented API that may break without notice and may be against Anthropic's Terms of Service. Use at your own risk. For a stable alternative, see [Claude subscription (oauth)](claude-subscription.md).
:::

---

## How it works

Routerly authenticates with `claude.ai` using your browser session key cookie. Requests are translated from the OpenAI Chat Completions format to the Claude.ai internal format and back.

---

## Step 1: Get your session cookie

1. Open [claude.ai](https://claude.ai) in your browser and log in.
2. Open DevTools: press `F12` or right-click and select **Inspect**.
3. Go to **Application** (Chrome/Edge) or **Storage** (Firefox).
4. Select **Cookies** in the left sidebar, then click `claude.ai`.
5. Find the cookie named `sessionKey` (value starts with `sk-ant-sid01-`). Copy its value.

:::info Cookie expiry
The session cookie expires when your browser session ends or after a period of inactivity. When requests start failing with a 401 error, repeat this step and update the model in Routerly.
:::

---

## Step 2: Add the model in Routerly

### Via the dashboard

Go to **Models > Add Model** and fill in:

| Field | Value |
|-------|-------|
| Provider | Claude (browser session) |
| Model ID | `anthropic-web/claude-opus-4-5` (or any model slug) |
| Session Token | paste the `sessionKey` cookie value |

### Via the CLI

```bash
routerly model add \
  --id claude-web-opus \
  --provider anthropic-web \
  --api-key sk-ant-sid01-...
```

---

## Step 3: Attach the model to a router

In the dashboard, go to **Routers > your router > Models** and add the model. Copy the router token.

---

## Step 4: Use it from your client

```bash
# OpenAI-compatible client
export OPENAI_BASE_URL="http://localhost:3000/v1"
export OPENAI_API_KEY="<routerly-router-token>"
```

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="<routerly-router-token>",
)

response = client.chat.completions.create(
    model="anthropic-web/claude-opus-4-5",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

```python
# Anthropic SDK
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="<routerly-router-token>",
)
```

---

## Supported models

Any model available in your Claude account can be used. Common values:

| Model | ID |
|-------|----|
| Claude Opus 4.5 | `anthropic-web/claude-opus-4-5` |
| Claude Sonnet 4.5 | `anthropic-web/claude-sonnet-4-5` |

The model slug must match what the Claude.ai internal API accepts. Use the same model slug shown in the Claude.ai interface.

---

## Limitations

- Token usage is not reported.
- Streaming is supported.
- The adapter reuses a conversation ID across requests to the same model instance; create a new model entry in Routerly to get a fresh conversation.
- System prompts are forwarded as the first human turn if the internal API does not support a dedicated system field.
