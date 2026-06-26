---
title: Playground
sidebar_position: 8
---

# Dashboard: Playground

The Playground lets you send chat requests directly from the browser without writing any code. It is useful for testing models, verifying routing behaviour, and debugging prompt changes.

---

## Getting Started

![Playground empty state showing the Token field, chat area, and Debug panel](../assets/screenshot-playground.png)

1. Open **Playground** from the sidebar
2. Enter a **Project Token** in the Token field (top right) — paste an `sk-rt-...` token from any project you have access to
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

Responses stream in real time when the selected project's routing configuration supports streaming. A stop button (⏹) appears while a response is in progress — click it to abort.

### Image Attachments

Click the **Attach Image** button (or paste an image) to include image content in your message. This requires the routed model to have the `vision` capability.

---

## Guardrail Block Indicator

When a security rule with `action: Block` triggers, the response area shows a
red **"[Request/Response] blocked by guardrail"** banner above the (empty) reply
bubble. The banner displays:

| Field | Description |
|-------|-------------|
| **Rule** | The rule identifier that triggered (e.g. `regex`, `injection:dan-mode`) |
| **Target** | Whether the block was on the `request` or `response` |
| **Action** | Always `block` for this banner |
| **Fallback message** | The project's configured fallback text (if set) |

The wire response seen by your application is a standard `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic) HTTP 200 — not an error. The Playground reads the trace to surface the richer block details shown in the banner.

## PII Scrubbed Indicator

When PII scrubbing is active, the **Technical Details** panel in the Debug sidebar shows a **"PII SCRUBBED"** entry (orange badge) for each turn where entities were detected. The entry lists each scrubbed entity type as a pill (e.g. `EMAIL`, `PHONE_NUMBER`). This indicator appears for both input scrubbing (before the request) and output scrubbing (after the response), depending on the project configuration.

## Debug Panels

The **Debug** sidebar (right side of the screen) shows one collapsible section per conversation turn. Expand a turn to see:

| Panel | Contents |
|-------|----------|
| **Turn summary** | Model used, token counts, latency |
| **Technical Details** | Full routing trace: policy scores, selected model, guardrail events, PII scrubbed entries |

These panels are invaluable for understanding why the router chose a specific model, diagnosing provider errors, or confirming that guardrails and PII scrubbing fired correctly.

---

## Clearing the Conversation

Click **Clear** to reset the message history. The system prompt (if any) is preserved.

---

## Limitations

- The Playground does not save conversations after a page refresh.
- Function-calling / tool-use responses are shown as raw JSON.
- Audio and document inputs are not supported via the Playground UI.
