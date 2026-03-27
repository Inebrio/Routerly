---
title: Jupyter
sidebar_label: Jupyter
---

# Jupyter

[Jupyter](https://jupyter.org) notebooks are the standard environment for Python-based data science and AI experimentation. Because Routerly speaks the OpenAI API, you can use the `openai` Python package inside any notebook without extra dependencies.

---

## Install

Install the OpenAI SDK in your notebook environment:

```python
%pip install openai
```

---

## Configure

Create the client once at the top of your notebook:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-rt-YOUR_PROJECT_TOKEN",
)
```

---

## Usage

### Chat completion

```python
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "Explain gradient descent in two sentences."}],
)
print(response.choices[0].message.content)
```

### Streaming

```python
stream = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "Write a haiku about neural networks."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

### Using Anthropic SDK

```python
%pip install anthropic
```

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="sk-rt-YOUR_PROJECT_TOKEN",
)

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=256,
    messages=[{"role": "user", "content": "What is backpropagation?"}],
)
print(message.content[0].text)
```

:::tip
Store your project token in a Jupyter environment variable rather than hardcoding it. Add `export ROUTERLY_TOKEN=sk-rt-…` to your shell profile and read it with `os.environ["ROUTERLY_TOKEN"]`.
:::
