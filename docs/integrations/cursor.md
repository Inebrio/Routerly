---
title: Cursor
sidebar_label: Cursor
---

# Cursor

[Cursor](https://cursor.com) is an AI-first code editor built on VS Code. Its AI features — inline completions, Composer, and Chat — all use the OpenAI API under the hood and can be redirected to Routerly.

---

## Install

Download Cursor from [cursor.com](https://cursor.com).

---

## Configure

1. Open Cursor → **Settings** → **Cursor Settings** → **Models**.
2. Scroll to **OpenAI API Key** and enter: `sk-rt-YOUR_PROJECT_TOKEN`
3. Enable **Override OpenAI Base URL** and set it to: `http://localhost:3000/v1`
4. Click **Verify** to confirm the connection.

:::note
Cursor sends model names from its own list. Because Routerly's router ignores the model field and selects the best candidate from your routing policy, this works correctly even if the model name does not match any registered model exactly. To pin a specific model, register it in your project and set the routing policy to `pinned`.
:::

---

## Usage

Use Cursor as normal. All AI requests — Tab completions, Chat, Composer — are proxied through Routerly. Cost data and routing traces appear in **Usage** in the Routerly dashboard.
