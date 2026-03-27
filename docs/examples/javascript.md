---
title: JavaScript / TypeScript
sidebar_label: JavaScript / TypeScript
---

# JavaScript / TypeScript

---

## OpenAI SDK

```bash
npm install openai
```

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "sk-lr-YOUR_PROJECT_TOKEN",
});

// Non-streaming
const response = await client.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Tell me a story." }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

---

## Anthropic SDK

```bash
npm install @anthropic-ai/sdk
```

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:3000",
  apiKey: "sk-lr-YOUR_PROJECT_TOKEN",
});

const message = await client.messages.create({
  model: "claude-haiku-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude!" }],
});
console.log(message.content[0].text);
```

---

## Raw HTTP (fetch)

No dependencies needed — works in Node.js 18+, Deno, Bun, and the browser.

```typescript
// Non-streaming
const response = await fetch("http://localhost:3000/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer sk-lr-YOUR_PROJECT_TOKEN",
  },
  body: JSON.stringify({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
const data = await response.json();
console.log(data.choices[0].message.content);

// Streaming (Server-Sent Events)
const streamRes = await fetch("http://localhost:3000/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer sk-lr-YOUR_PROJECT_TOKEN",
  },
  body: JSON.stringify({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Tell me a story." }],
    stream: true,
  }),
});

const reader = streamRes.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const lines = decoder.decode(value).split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const json = JSON.parse(line.slice(6));
    if (json.type === "content") process.stdout.write(json.delta);         // Routerly SSE
    else process.stdout.write(json.choices?.[0]?.delta?.content ?? "");    // standard SSE
  }
}
```
