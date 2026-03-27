---
title: Python
sidebar_label: Python
---

# Python

---

## OpenAI SDK

```bash
pip install openai
```

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-rt-YOUR_PROJECT_TOKEN",
)

# Non-streaming
response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "Tell me a story."}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

---

## Anthropic SDK

```bash
pip install anthropic
```

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="sk-rt-YOUR_PROJECT_TOKEN",
)

# Non-streaming
message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello, Claude!"}],
)
print(message.content[0].text)

# Streaming
with client.messages.stream(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Tell me a story."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

---

## Raw HTTP (httpx)

```bash
pip install httpx
```

```python
import httpx
import json

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-rt-YOUR_PROJECT_TOKEN",
}

# Non-streaming
with httpx.Client() as client:
    r = client.post(
        "http://localhost:3000/v1/chat/completions",
        headers=HEADERS,
        json={
            "model": "gpt-5-mini",
            "messages": [{"role": "user", "content": "Hello!"}],
        },
    )
    r.raise_for_status()
    print(r.json()["choices"][0]["message"]["content"])

# Streaming
with httpx.Client() as client:
    with client.stream(
        "POST",
        "http://localhost:3000/v1/chat/completions",
        headers=HEADERS,
        json={
            "model": "gpt-5-mini",
            "messages": [{"role": "user", "content": "Tell me a story."}],
            "stream": True,
        },
    ) as r:
        for line in r.iter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            data = json.loads(line[6:])
            delta = data.get("choices", [{}])[0].get("delta", {}).get("content", "")
            print(delta, end="", flush=True)
```

:::tip
Use `ROUTERLY_API_KEY` as an environment variable instead of hardcoding the token:
```python
import os
client = OpenAI(base_url="http://localhost:3000/v1", api_key=os.environ["ROUTERLY_API_KEY"])
```
:::
