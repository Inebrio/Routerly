---
title: Any OpenAI SDK app
sidebar_label: Any OpenAI SDK app
---

# Any OpenAI SDK app

Anything built on the official OpenAI SDKs, or on any library that reads
`OPENAI_BASE_URL`, works with Routerly by changing the base URL and the API
key. No client-side code changes: Routerly forwards the request and returns
the provider's response unaltered.

**Support state:** `documented`. Configured by hand.
**Config:** environment variables, no file
**Wire format:** OpenAI
**Connect modes:** LLM

---

## Print the steps

```bash
routerly clients configure generic-openai --project my-api
```

Prints the two variables with a real project token, mints one if you do not
pass `--token`, and writes nothing. The dashboard shows the same pair under
**Connect → Any OpenAI SDK app**.

## Environment variables

```bash
export OPENAI_BASE_URL=http://localhost:3000/v1
export OPENAI_API_KEY=sk-rt-YOUR_PROJECT_TOKEN
```

The `/v1` suffix belongs to the base URL. Create a project token on the
[Projects](../dashboard/projects.md) page.

## In code

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-rt-YOUR_PROJECT_TOKEN",
)

response = client.chat.completions.create(
    model="routerly/ada",
    messages=[{"role": "user", "content": "Hello"}],
)
```

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'sk-rt-YOUR_PROJECT_TOKEN',
});

const response = await client.chat.completions.create({
  model: 'routerly/ada',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

`routerly/ada` asks Routerly to pick the model per request, following the
project's routing profile. Pass a registered model id instead to address
one model directly.

## Check the connection

```bash
routerly clients doctor
```

Reports whether the service is reachable from this machine. See
[Examples](../examples/overview.md) for one runnable snippet per language,
and [Concepts: Routing](../concepts/routing.md) for how a request is routed.
