---
title: Open WebUI
sidebar_label: Open WebUI
---

# Open WebUI

[Open WebUI](https://openwebui.com) is a self-hosted chat interface that supports multiple OpenAI-compatible backends. Connect it to Routerly to route every conversation through your configured models and policies.

---

## Install

Follow the [Open WebUI installation guide](https://docs.openwebui.com/getting-started/) — Docker is the quickest path:

```bash
docker run -d -p 3001:8080 --name open-webui ghcr.io/open-webui/open-webui:main
```

---

## Configure

1. Open Open WebUI → **Admin Panel** → **Settings** → **Connections**.
2. Under **OpenAI API**, set:
   - **API Base URL** → `http://localhost:3000/v1`
   - **API Key** → `sk-rt-YOUR_PROJECT_TOKEN`
3. Click **Save**.
4. Open **Admin Panel** → **Settings** → **Models** and click the sync button to import your Routerly model list.

:::note
If Routerly is running in Docker alongside Open WebUI, use the container name or host IP instead of `localhost` — for example `http://routerly:3000/v1`.
:::

---

## Usage

Start a new chat. Select any model from the model picker — the list is fetched live from Routerly's `/v1/models` endpoint. All requests pass through Routerly's routing engine, so budget enforcement and cost tracking apply automatically.
