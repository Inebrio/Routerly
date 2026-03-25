---
title: Zapier
sidebar_label: Zapier
---

# Zapier

[Zapier](https://zapier.com) is a no-code automation platform. Use the built-in **Webhooks by Zapier** action to call Routerly from any Zap.

---

## Configure

Zapier does not have a native Routerly action, but **Webhooks by Zapier → POST** works perfectly.

1. Add a **Webhooks by Zapier** action and choose **POST**.
2. Set:

| Field | Value |
|-------|-------|
| **URL** | `https://your-routerly-instance.example.com/v1/chat/completions` |
| **Payload Type** | JSON |
| **Data** | See below |
| **Headers** | `Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN` |

Data fields to add:

| Key | Value |
|-----|-------|
| `model` | `gpt-5-mini` |
| `messages[0][role]` | `user` |
| `messages[0][content]` | *(mapped from a previous Zap step)* |

3. Zapier will send a `POST` to Routerly and receive a standard `ChatCompletion` JSON response.
4. Use **Zapier Formatter → Text → Extract Pattern** to pull `choices.0.message.content` from the response.

:::note
Zapier operates from the cloud, so your Routerly instance must be publicly reachable. For local development, use [ngrok](https://ngrok.com) to expose your local server temporarily.
:::

---

## Usage

Test the step in Zapier's editor — a real request will be sent to Routerly. The response body is a standard OpenAI object you can map to any subsequent Zap action.
