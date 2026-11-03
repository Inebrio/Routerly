---
title: Use ChatGPT via browser session
sidebar_label: ChatGPT (browser session)
sidebar_position: 4
---

# Use ChatGPT via browser session (openai-web)

The `openai-web` provider lets you route requests through your existing ChatGPT Plus/Pro account using your browser session token, without a separate API key.

:::warning Unofficial adapter
This provider uses an internal, undocumented API that may break without notice and may be against OpenAI's Terms of Service. Use at your own risk. For a stable alternative, see [ChatGPT subscription (oauth)](openai-subscription.md).
:::

---

## How it works

Routerly authenticates with `chatgpt.com` using your browser session token and optionally a Cloudflare clearance cookie. Requests are translated from the OpenAI API format to the ChatGPT internal format and back.

---

## Step 1: Get your session token

1. Open [chatgpt.com](https://chatgpt.com) in your browser and log in.
2. Open DevTools: press `F12` or right-click and select **Inspect**.
3. Go to the **Network** tab.
4. Navigate to `https://chatgpt.com/api/auth/session` (paste in the address bar or find it in the network log).
5. In the response JSON, find the `accessToken` field. Copy its value.

:::info Token expiry
The session token expires after a few days. When requests start failing with a 401 error, repeat this step and update the model in Routerly.
:::

---

## Step 2: Get the cf_clearance cookie (optional but recommended)

If Routerly receives Cloudflare errors (403 with a challenge), provide the `cf_clearance` cookie:

1. In DevTools, go to **Application** (Chrome/Edge) or **Storage** (Firefox).
2. Select **Cookies** in the left sidebar, then click `chatgpt.com`.
3. Find the cookie named `cf_clearance` and copy its value.

---

## Step 3: Add the model in Routerly

### Via the dashboard

Go to **Models > Add Model** and fill in:

| Field | Value |
|-------|-------|
| Provider | ChatGPT (browser session) |
| Model ID | `openai-web/gpt-4o` (or any model slug) |
| Access Token | paste the `accessToken` value from Step 1 |
| CF Clearance | paste the `cf_clearance` cookie value from Step 2 (optional) |

### Via the CLI

```bash
routerly model add \
  --id openai-web-gpt4o \
  --provider openai-web \
  --api-key <accessToken>
```

To include the `cf_clearance` cookie:

```bash
routerly model add \
  --id openai-web-gpt4o \
  --provider openai-web \
  --api-key <accessToken> \
  --cf-clearance <cf_clearance value>
```

---

## Step 4: Attach the model to a router

In the dashboard, go to **Routers > your router > Models** and add the model. Copy the router token.

---

## Step 5: Use it from your client

```bash
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
    model="openai-web/gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

---

## Supported models

Any model slug available in your ChatGPT account can be used. Common values:

| Model | ID |
|-------|----|
| GPT-4o | `openai-web/gpt-4o` |
| GPT-4o mini | `openai-web/gpt-4o-mini` |
| o3 | `openai-web/o3` |

---

## Limitations

- Token usage is not reported (the internal API does not expose per-token counts).
- Streaming is supported; however, response latency may be higher than with the API.
- The Cloudflare bot check occasionally requires a fresh `cf_clearance` cookie.
- System prompts are forwarded as a `system_prompt` field in the ChatGPT internal API.
