---
title: Cline
sidebar_label: Cline
---

# Cline

[Cline](https://github.com/cline/cline) is an autonomous coding agent that can read files, write code, run terminal commands, and browse the web. It runs inside VS Code and uses the OpenAI or Anthropic API for its reasoning model.

---

## Install

Install the [Cline extension](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) from the VS Code Marketplace.

---

## Configure

1. Open the Cline extension panel and click the **Settings** gear.
2. Set **API Provider** to `OpenAI Compatible`.
3. Fill in:
   - **Base URL** → `http://localhost:3000/v1`
   - **API Key** → `sk-lr-YOUR_PROJECT_TOKEN`
   - **Model** → any model registered in your Routerly project (e.g. `gpt-5-mini`)
4. Set **Context Window** to at least `32000` — agentic tasks require a large context.

To use Anthropic via Routerly:

1. Set **API Provider** to `Anthropic`.
2. Set **Base URL** to `http://localhost:3000` (no `/v1`).
3. Set **API Key** to `sk-lr-YOUR_PROJECT_TOKEN`.
4. Pick a model (e.g. `claude-haiku-4-5`).

:::note
Agentic tasks consume many tokens per step. Set a [budget limit](../concepts/budgets-and-limits) on your project token to cap spending automatically.
:::

---

## Usage

Open the Cline panel and describe the task. Cline will plan, write code, and execute steps autonomously. Every LLM call is routed through Routerly — costs and traces are visible in the dashboard.
