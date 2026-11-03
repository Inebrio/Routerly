---
title: Playground
sidebar_position: 8
---

# Dashboard: Playground

The Playground lets you send chat requests directly from the browser without writing any code. It is useful for testing models, verifying routing behaviour, and debugging prompt changes.

---

## Getting Started

1. Open **Playground** from the sidebar
2. Select a **Project Token** from the dropdown — only tokens from projects you have access to are listed
3. Type a message in the input box and press **Send** (or `Enter`)

---

## Interface

### Message History

Messages are displayed in a conversational thread. Each message shows:
- The role (`user` / `assistant`)
- The content (with Markdown rendering for assistant responses)
- For image inputs: a thumbnail

The conversation history is maintained for the duration of the browser session and sent with each request as `messages` context.

### Model Display

The model actually used is shown above each assistant response. If routing assigned a different model than expected, this is where you'll see it.

### Streaming

Responses stream in real time when the selected project's routing configuration supports streaming. A stop button (⏹) appears while a response is in progress — click it to abort.

### Image Attachments

Click the **Attach Image** button (or paste an image) to include image content in your message. This requires the routed model to have the `vision` capability.

---

## Debug Panels

Below the conversation, four collapsible panels show the complete request lifecycle:

| Panel | Contents |
|-------|----------|
| **Router Request** | Project slug, requested model (if any), active routing policies |
| **Router Response** | Policy scores, candidate models, selected model and reason |
| **Model Request** | Exact payload sent to the provider |
| **Model Response** | Raw provider response including token counts and finish reason |

These panels are invaluable for understanding why the router chose a specific model, or for diagnosing provider errors.

---

## Clearing the Conversation

Click **Clear** to reset the message history. The system prompt (if any) is preserved.

---

## Limitations

- The Playground does not save conversations after a page refresh.
- Function-calling / tool-use responses are shown as raw JSON.
- Audio and document inputs are not supported via the Playground UI.
