---
title: n8n
sidebar_label: n8n
---

# n8n

[n8n](https://n8n.io) is a self-hostable workflow automation platform. Its **OpenAI node** and generic **HTTP Request node** both connect to Routerly out of the box.

---

## Install

Run n8n via Docker:

```bash
docker run -it --rm -p 5678:5678 n8nio/n8n
```

Or follow the [full n8n installation guide](https://docs.n8n.io/hosting/).

---

## Configure

### Option A — OpenAI node (recommended)

1. In n8n, go to **Credentials** → **New** → **OpenAI API**.
2. Set:
   - **API Key** → `sk-lr-YOUR_PROJECT_TOKEN`
   - **Base URL** → `http://localhost:3000/v1`
3. Save the credential with a recognisable name (e.g. *Routerly*).
4. Add an **OpenAI** node to your workflow and select the new credential.

### Option B — HTTP Request node

For full control over the request body:

1. Add an **HTTP Request** node.
2. Set **Method** to `POST` and **URL** to `http://localhost:3000/v1/chat/completions`.
3. Add a header: `Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN`.
4. Use **JSON Body**:

```json
{
  "model": "gpt-5-mini",
  "messages": [
    { "role": "user", "content": "{{ $json.prompt }}" }
  ]
}
```

---

## Usage

Connect the Routerly credential to any OpenAI node in your workflows. Cost data for each call is visible in the Routerly dashboard under **Usage**.
