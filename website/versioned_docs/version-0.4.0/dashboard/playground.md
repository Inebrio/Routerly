---
title: Playground
sidebar_position: 9
---

# Dashboard: Playground

The Playground lets you send chat requests directly from the browser without writing any code. It is useful for testing models, verifying routing behaviour, and debugging prompt changes.

---

## Getting Started

![Playground empty state showing the Token field, chat area, and Debug panel](../assets/screenshot-playground.png)

1. Open **Playground** from the sidebar
2. Enter a **Project Token** in the Token field (top right): paste an `sk-rt-...` token from any project you have access to
3. Type a message in the input box at the bottom and press **Send** (or `Enter`)

---

## Interface

### Message History

Messages are displayed in a conversational thread. Each message shows:
- The role (`user` / `assistant`)
- The content (with Markdown rendering for assistant responses)
- For image inputs: a thumbnail

The conversation history is maintained for the duration of the browser session and sent with each request as `messages` context.

### Mode

Use the **Single** / **Compare** toggle (top right) to switch between a single-model chat and a side-by-side comparison view.

### Model Display

The model actually used is shown above each assistant response. If routing assigned a different model than expected, this is where you'll see it.

### Streaming

Responses stream in real time when the selected project's routing configuration supports streaming. A stop button (⏹) appears while a response is in progress - click it to abort.

**Streaming disabled notice:** When the project has one or more guardrail rules that judge responses (Response flag enabled), streaming is automatically disabled because the entire response must be buffered before the block decision is made. You will see a banner at the top of the chat area explaining this, and the stream toggle will be disabled.

### Image Attachments

Click the **Attach Image** button (or paste an image) to include image content in your message. This requires the routed model to have the `vision` capability.

---

## Guardrail Block Indicator

When a judged guardrail rule (topic/moderation with Request or Response flag) triggers, the block message is displayed as a normal assistant message in the chat (not a red box). The message shown is the judge model's own explanation, in the same language as the user's latest message. If the judge fails or returns no explanation, a built-in default is used.

The wire response seen by your application is a standard `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic) HTTP 200 response, not an error. Empty content is returned. The Playground displays the block message here for convenience, but it is stored only in the trace, not in the wire response sent to API consumers.

## Debug

The **Debug** sidebar (right side of the screen) shows one card per conversation
turn, newest first: the turn you just sent is open at the top, the earlier ones
folded under it. Each card reads on two levels: the **summary** in the card
itself, and the **trace log** it holds one click deeper. Same two levels the
[Usage trace view](usage.md#trace-view) uses, on the same data. Clicking the turn
header folds the whole card away.

![Playground Debug panel showing the turn summary card above the collapsed trace log](../assets/screenshot-playground-trace.png)

### Summary card

Built from the `trace:recap` entry the service writes when the request finishes.
It carries the outcome (`ok`, `blocked`, `error`), the model and provider, the
duration and cost, the token counts, and one section each for guardrails, PII,
optimizers and router overhead -- each shown only when that part of the pipeline
did something. A blocked turn is never empty: there is no completion, but the
card still reports which rule blocked it and what the judge calls cost.

### Trace log

**Turn #N trace log** opens the detail level: every entry the pipeline emitted,
grouped by phase (Ingress, Request · Preprocess, Routing · Prepare, Routing ·
Execute, Response · Postprocess, Finalize), each stamped with its offset from the
start of the request. Phases start folded so the log never pushes the
conversation off screen.

This is where you see the individual guardrail rules with their scores and
thresholds, the PII scan on both sides of the call, every optimizer step, the
policy scores behind the routing decision, and the payload actually sent
upstream. The full list of entries is documented in the
[Usage trace view](usage.md#trace-log).

:::note
Trace data never travels on the LLM wire. The Playground picks a correlation id, sends it on the request as `x-routerly-trace`, and reads the entries live from the management side channel (`GET /api/traces/stream`). The response returned to your application is exactly what the provider sent.
:::

Entries arrive as they happen, so the log fills in while the answer is still
streaming: PII and guardrail checks first, then the routing decision, then the
upstream call. The summary card appears at the end, when the recap is written --
the Playground then reloads the stored trace, so the block you are left with is
the same one the Usage page will show. Prompts and answers appear on the trace
only for projects with **Trace content** enabled (Project → General); otherwise
the trace is metadata only.

The same two levels are shown on a project's **Test** tab, which runs the same
Playground against that project.

---

## Clearing the Conversation

Click **Clear** to reset the message history. The system prompt (if any) is preserved.

---

## Limitations

- The Playground does not save conversations after a page refresh.
- Function-calling / tool-use responses are shown as raw JSON.
- Audio and document inputs are not supported via the Playground UI.
