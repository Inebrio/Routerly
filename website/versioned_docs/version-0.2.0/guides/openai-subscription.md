---
title: Use your ChatGPT subscription
sidebar_label: ChatGPT subscription
sidebar_position: 3
---

# Use your ChatGPT Plus/Pro subscription

If you have an active **ChatGPT Plus or Pro subscription**, you can use it as a model in Routerly without a separate OpenAI API key.

:::warning
Using a consumer subscription through a gateway may be against OpenAI's Terms of Service. Use at your own risk.
:::

---

## How it works

1. You generate a token from the Codex app or CLI.
2. You add it to Routerly as a model (provider: **OpenAI (ChatGPT Plus/Pro subscription)**).
3. Any client pointed at Routerly can use that model. Routerly handles the authentication with OpenAI transparently.

Your token is stored in `~/.routerly/config/models.json` and is never sent to clients.

---

## Step 1: Get your subscription token

Open the Codex app, go to **Settings**, and copy your OAuth token. Alternatively, open a terminal and run:

```bash
codex setup-token
```

This prints a token. Copy it.

:::info Token expiry
This token is not auto-refreshed. When it expires, generate a new one and update the model in Routerly.
:::

---

## Step 2: Add the model in Routerly

### Via the dashboard

Go to **Models > Add Model** and fill in:

| Field | Value |
|-------|-------|
| Provider | OpenAI (ChatGPT Plus/Pro subscription) |
| Model Preset | pick from the list, or enter a custom model name |
| Subscription OAuth Token | paste the token |

The endpoint URL is filled in automatically.

### Via the CLI

```bash
routerly model add \
  --id gpt4o-sub \
  --provider openai-oauth \
  --api-key <your-token>
```

---

## Step 3: Attach the model to a project

In the dashboard, go to **Projects > your project > Models** and add the model you just created. Copy the project token: you will use it as the API key for your client.

---

## Step 4: Use it from your client

Point your client at Routerly and authenticate with the **Routerly project token** (not the OAuth token):

```bash
export OPENAI_BASE_URL="http://localhost:3000/v1"
export OPENAI_API_KEY="<routerly-project-token>"
```

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="<routerly-project-token>",
)
```

Routerly authenticates the request, swaps in your stored subscription token, and forwards to OpenAI.

---

## API-key model vs. subscription model

|  | API-key (`openai`) | Subscription (`openai-oauth`) |
|--|--|--|
| Credential | `sk-...` | Codex OAuth token |
| Cost tracking | per-token | not available (flat subscription) |
| Compatible clients | any | any (token swap is server-side) |

Both can coexist: you can have an `openai-oauth` model alongside your existing `openai` API-key models in the same project.
