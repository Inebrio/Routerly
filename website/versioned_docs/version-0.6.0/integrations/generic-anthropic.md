---
title: Any Anthropic SDK app
sidebar_label: Any Anthropic SDK app
---

# Any Anthropic SDK app

Anything built on the official Anthropic SDKs, or on any library that reads
`ANTHROPIC_BASE_URL`, works with Routerly by changing the base URL and the
auth token. No client-side code changes: Routerly forwards the request and
returns the provider's response unaltered.

**Support state:** `documented`. Configured by hand.
**Config:** environment variables, no file
**Wire format:** Anthropic
**Connect modes:** LLM

---

## Print the steps

```bash
routerly clients configure generic-anthropic --router my-api
```

Prints the two variables with a real router token, mints one if you do not
pass `--token`, and writes nothing. The dashboard shows the same pair under
**Connect → Any Anthropic SDK app**.

## Environment variables

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_AUTH_TOKEN=sk-rt-YOUR_ROUTER_TOKEN
```

No `/v1` here: the Anthropic SDK appends its own `/v1/messages`.

`ANTHROPIC_AUTH_TOKEN` sends `Authorization: Bearer`, `ANTHROPIC_API_KEY`
sends `x-api-key`. Routerly accepts both and gives Bearer precedence when
the two are set at once.

Create a router token on the [Routers](../dashboard/routers.md) page.

## In code

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:3000",
    api_key="sk-rt-YOUR_ROUTER_TOKEN",
)

message = client.messages.create(
    model="routerly/ada",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'http://localhost:3000',
  apiKey: 'sk-rt-YOUR_ROUTER_TOKEN',
});

const message = await client.messages.create({
  model: 'routerly/ada',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
});
```

`routerly/ada` asks Routerly to pick the model per request, following the
router's routing profile. Pass a registered model id instead to address
one model directly.

## Check the connection

```bash
routerly clients doctor
```

Reports whether the service is reachable from this machine. See
[Examples](../examples/overview.md) for one runnable snippet per language,
and [Concepts: Routing](../concepts/routing.md) for how a request is routed.
