---
title: Client Integration
sidebar_position: 2
---

# Client Integration

Routerly is a drop-in replacement for the OpenAI and Anthropic APIs. Change two things in your existing client configuration:

1. **Base URL** → your Routerly instance (e.g. `http://localhost:3000`)
2. **API key** → your project token (`sk-lr-…`)

No other code changes are needed.

---

## OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-lr-YOUR_PROJECT_TOKEN",
)

response = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "Summarize this document..."}],
    stream=True,
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

---

## OpenAI Node.js / TypeScript SDK

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-lr-YOUR_PROJECT_TOKEN',
});

// Non-streaming
const response = await client.chat.completions.create({
  model: 'gpt-5-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: 'gpt-5-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

---

## Anthropic Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="sk-lr-YOUR_PROJECT_TOKEN",
)

message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)
```

---

## Anthropic Node.js / TypeScript SDK

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3000',
  apiKey: 'sk-lr-YOUR_PROJECT_TOKEN',
});

const message = await client.messages.create({
  model: 'claude-haiku-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(message.content[0].type === 'text' ? message.content[0].text : '');
```

---

## LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-5-mini",
    base_url="http://localhost:3000/v1",
    api_key="sk-lr-YOUR_PROJECT_TOKEN",
)

result = llm.invoke("What is the capital of France?")
print(result.content)
```

---

## LangChain (JavaScript / TypeScript)

```typescript
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({
  model: 'gpt-5-mini',
  configuration: {
    baseURL: 'http://localhost:3000/v1',
    apiKey: 'sk-lr-YOUR_PROJECT_TOKEN',
  },
});

const result = await llm.invoke('What is the capital of France?');
console.log(result.content);
```

---

## Cursor IDE

Configure a custom AI model in Cursor:

1. Open **Cursor → Settings → Models**
2. Click **+ Add Model**
3. Set:
   - **Name:** Routerly
   - **API Base:** `http://localhost:3000/v1`
   - **API Key:** `sk-lr-YOUR_PROJECT_TOKEN`
   - **Model:** `gpt-5-mini` (or any model registered in your project)
4. Save and select **Routerly** as the active model

---

## Open WebUI

[Open WebUI](https://github.com/open-webui/open-webui) is a self-hosted chat interface compatible with OpenAI-format APIs.

1. In Open WebUI, go to **Settings → Connections**
2. Add an **OpenAI API** connection:
   - **API Base URL:** `http://localhost:3000/v1`
   - **API Key:** `sk-lr-YOUR_PROJECT_TOKEN`
3. Save and refresh the model list — your Routerly-registered models will appear

---

## OpenClaw (Claude desktop client)

OpenClaw connects to Anthropic-compatible endpoints. Routerly exposes `/v1/messages` which uses the Anthropic wire format natively.

1. Open OpenClaw and go to **Settings → API**
2. Set:
   - **API Base URL:** `http://localhost:3000`
   - **API Key:** `sk-lr-YOUR_PROJECT_TOKEN`
3. Select any Claude model registered in your Routerly project

---

## LibreChat

[LibreChat](https://www.librechat.ai/) supports custom OpenAI-compatible endpoints.

1. In your `librechat.yaml` configuration file, add an endpoint:

```yaml
endpoints:
  custom:
    - name: "Routerly"
      apiKey: "sk-lr-YOUR_PROJECT_TOKEN"
      baseURL: "http://localhost:3000/v1"
      models:
        default: ["gpt-5-mini"]
        fetch: false
      titleConvo: true
      titleModel: "gpt-5-mini"
      summarize: false
      summaryModel: "gpt-5-mini"
      forcePrompt: false
      dropParams: []
```

2. Restart LibreChat — **Routerly** will appear as a selectable endpoint

---

## curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

### Streaming with curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-YOUR_PROJECT_TOKEN" \
  -H "Content-Type: application/json" \
  --no-buffer \
  -d '{
    "model": "gpt-5-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

---

## Any OpenAI-compatible Client

Routerly works with any HTTP client or library that supports the OpenAI chat completions format. The only required changes are:

| Setting | Old value | New value |
|---------|-----------|-----------|
| Base URL | `https://api.openai.com/v1` | `http://localhost:3000/v1` |
| API key | `sk-…` | `sk-lr-YOUR_PROJECT_TOKEN` |
