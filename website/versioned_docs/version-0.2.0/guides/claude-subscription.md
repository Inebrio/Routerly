---
title: Use your Claude subscription
sidebar_label: Claude subscription
sidebar_position: 2
---

# Use your Claude Pro/Max subscription

If you have an active **Claude Pro or Max subscription**, you can use it as a model in Routerly without a separate API key.

:::warning
Using a consumer subscription through a gateway may be against Anthropic's Terms of Service. Use at your own risk.
:::

---

## How it works

1. You generate a long-lived token from your Claude account.
2. You add it to Routerly as a model (provider: **Anthropic Pro/Max subscription**).
3. Any client pointed at Routerly can use that model. Routerly handles the authentication with Anthropic transparently.

Your token is stored in `~/.routerly/config/models.json` and is never sent to clients.

---

## Step 1: Get your subscription token

Open a terminal and run:

```bash
claude setup-token
```

This prints a long-lived token starting with `sk-ant-oat...`. Copy it.

:::info Token expiry
This token is not auto-refreshed. When it expires, run `claude setup-token` again and update the model in Routerly.
:::

---

## Step 2: Add the model in Routerly

### Via the dashboard

Go to **Models > Add Model** and fill in:

| Field | Value |
|-------|-------|
| Provider | Anthropic (Pro/Max subscription) |
| Model Preset | pick from the list, or enter a custom model name |
| Subscription OAuth Token | paste the `sk-ant-oat...` token |

The endpoint URL is filled in automatically.

### Via the CLI

```bash
routerly model add \
  --id claude-max \
  --provider anthropic-oauth \
  --api-key sk-ant-oat...
```

---

## Step 3: Attach the model to a project

In the dashboard, go to **Projects > your project > Models** and add the model you just created. Copy the project token: you will use it as the API key for your client.

---

## Step 4: Use it from your client

Point your client at Routerly and authenticate with the **Routerly project token** (not the OAuth token):

```bash
# Example with Claude Code
export ANTHROPIC_BASE_URL="http://localhost:3000"
export ANTHROPIC_AUTH_TOKEN="<routerly-project-token>"

claude -p "hello"
```

```python
# Example with the Anthropic Python SDK
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="<routerly-project-token>",
)
```

Routerly authenticates the request, swaps in your stored subscription token, and forwards to Anthropic.

---

## API-key model vs. subscription model

|  | API-key (`anthropic`) | Subscription (`anthropic-oauth`) |
|--|--|--|
| Credential | `sk-ant-api...` | `sk-ant-oat...` |
| Cost tracking | per-token | not available (flat subscription) |
| Compatible clients | any | any (token swap is server-side) |

Both can coexist: you can have an `anthropic-oauth` model alongside your existing `anthropic` API-key models in the same project.
