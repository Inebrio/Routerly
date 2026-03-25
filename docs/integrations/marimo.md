---
title: marimo
sidebar_label: marimo
---

# marimo

[marimo](https://marimo.io) is a reactive Python notebook where cells re-run automatically when their inputs change. It has a built-in AI cell assistant that calls an OpenAI-compatible endpoint — point it at Routerly to route those calls through your policies.

---

## Install

```bash
pip install marimo
```

---

## Configure

### AI cell assistant

marimo's built-in AI features read from environment variables. Set them before launching:

```bash
export OPENAI_API_KEY="sk-lr-YOUR_PROJECT_TOKEN"
export OPENAI_BASE_URL="http://localhost:3000/v1"
marimo edit notebook.py
```

### SDK calls inside cells

You can also use the OpenAI or Anthropic SDK directly inside marimo cells:

```python
import marimo as mo
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-lr-YOUR_PROJECT_TOKEN",
)

prompt = mo.ui.text(placeholder="Ask something…")
prompt
```

```python
# Runs reactively whenever `prompt` changes
if prompt.value:
    response = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[{"role": "user", "content": prompt.value}],
    )
    mo.md(response.choices[0].message.content)
```

---

## Usage

Launch your notebook with `marimo edit notebook.py`. The AI cell assistant button and any direct SDK calls will route through Routerly. Usage data appears in the Routerly dashboard under **Usage**.
