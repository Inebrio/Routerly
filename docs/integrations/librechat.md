---
title: LibreChat
sidebar_label: LibreChat
---

# LibreChat

[LibreChat](https://librechat.ai) is a self-hosted, open-source chat platform with support for multiple AI providers. Because it uses the OpenAI API protocol natively, it works with Routerly without any plugins.

---

## Install

Follow the [LibreChat installation docs](https://www.librechat.ai/docs/installation/docker_compose). The Docker Compose setup is the most straightforward:

```bash
git clone https://github.com/danny-avila/LibreChat.git
cd LibreChat
cp .env.example .env
docker compose up -d
```

---

## Configure

Open `librechat.yaml` (or your `.env`) and point the OpenAI endpoint at Routerly:

```yaml
# librechat.yaml
endpoints:
  openAI:
    baseURL: "http://localhost:3000/v1"
    apiKey: "sk-lr-YOUR_PROJECT_TOKEN"
    models:
      default: ["gpt-5-mini"]
      fetch: true   # pull the model list from /v1/models
```

Restart the container after editing:

```bash
docker compose restart
```

:::tip
Set `fetch: true` so LibreChat pulls the model list from Routerly automatically — no need to hardcode model names.
:::

---

## Usage

Log in to LibreChat, select **OpenAI** from the endpoint picker, and start chatting. Every request flows through Routerly's routing and cost-tracking pipeline.
