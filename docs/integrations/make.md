---
title: Make
sidebar_label: Make
---

# Make

[Make](https://make.com) (formerly Integromat) is a visual workflow automation platform. Use its **HTTP module** to call Routerly from any scenario.

---

## Configure

Make does not have a native Routerly module, but its **HTTP → Make a request** action handles it cleanly.

1. Add a **HTTP → Make a request** module to your scenario.
2. Configure it:

| Field | Value |
|-------|-------|
| **URL** | `http://localhost:3000/v1/chat/completions` |
| **Method** | `POST` |
| **Headers** | `Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN` / `Content-Type: application/json` |
| **Body type** | Raw |
| **Content type** | JSON (application/json) |
| **Request content** | See below |

```json
{
  "model": "gpt-5-mini",
  "messages": [
    { "role": "user", "content": "{{1.text}}" }
  ]
}
```

3. Map `{{1.text}}` (or any other variable) to the prompt you want to send.
4. Parse the response: the reply is at `choices[0].message.content`.

:::note
Replace `localhost:3000` with your production Routerly URL if Make is connecting over the internet. Make sure the endpoint is accessible from Make's cloud infrastructure.
:::

---

## Usage

Run the scenario. The response body contains a standard OpenAI `ChatCompletion` object. Use the Make **JSON → Parse JSON** module to extract the reply text.
