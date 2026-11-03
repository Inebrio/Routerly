---
title: OpenClaw
sidebar_label: OpenClaw
---

# OpenClaw

[OpenClaw](https://openclaw.ai) is a personal AI agent that runs on your machine and lets you interact with it via Telegram, WhatsApp, Discord, iMessage, and other channels. It supports Custom Provider (OpenAI-compatible) endpoints, so you can point it at Routerly during setup or at any time afterwards.

---

## Install

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

The script detects your OS, installs Node.js if needed, and launches the onboarding wizard.

---

## Configure

### During onboarding

When `openclaw onboard` asks you to choose a model provider, select **Custom Provider (OpenAI-compatible)** and enter:

- **Base URL** → `http://localhost:3000/v1`
- **API Key** → `sk-rt-YOUR_PROJECT_TOKEN`
- **Default model** → any model configured in your Routerly project (e.g. `gpt-4o`, `claude-opus-4-5`)

### After onboarding

To switch an existing installation to Routerly, re-run the model configuration step:

```bash
openclaw configure --section model
```

Follow the same prompts: choose **Custom Provider (OpenAI-compatible)** and enter the Routerly base URL and project token above.

---

## Usage

Once the Gateway is running (`openclaw gateway status`), every message you send through your configured channel (Telegram, WhatsApp, etc.) goes through Routerly's routing engine. Cost tracking and budget enforcement apply automatically.

Open the dashboard to verify:

```bash
openclaw dashboard
```

:::tip
If OpenClaw and Routerly are running on the same machine, use `http://localhost:3000/v1` as the base URL. If Routerly is on a different host or in Docker, replace `localhost` with the appropriate address.
:::
