---
title: OpenClaw
sidebar_label: OpenClaw
---

# OpenClaw

[OpenClaw](https://openclaw.ai) is a lightweight, privacy-focused chat client that connects to any OpenAI-compatible endpoint. It is one of the fastest ways to get a usable chat interface on top of Routerly.

---

## Install

Download OpenClaw from [openclaw.ai](https://openclaw.ai) or install it via Homebrew on macOS:

```bash
brew install --cask openclaw
```

---

## Configure

1. Open OpenClaw → **Settings** → **API**.
2. Set:
   - **Base URL** → `http://localhost:3000/v1`
   - **API Key** → `sk-lr-YOUR_PROJECT_TOKEN`
3. Click **Connect**. OpenClaw will fetch the model list from Routerly.

---

## Usage

Pick a model from the sidebar and open a new conversation. Messages are routed through Routerly's engine — the routing trace and cost data appear in the Routerly dashboard under **Usage**.
