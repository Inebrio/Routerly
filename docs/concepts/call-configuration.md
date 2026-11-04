---
title: Call configuration
sidebar_position: 6
---

# Call configuration

A router normally decides only **which model** answers. A call configuration lets it also decide **how the model is called**: reasoning effort, output token cap and verbosity, chosen by how complex the request looks.

It is off by default. With no call configuration, or with `enabled: false`, Routerly does not read or write any of these parameters: the payload sent to the provider is byte-identical to what it was before the feature existed.

## What you can set

Three settings, each optional, per complexity tier:

| Setting | Values | Meaning |
|---------|--------|---------|
| `effort` | `low`, `medium`, `high` | Reasoning effort |
| `maxOutputTokens` | integer, 16 to 1000000 | Cap on tokens the model may generate |
| `verbosity` | `low`, `medium`, `high` | How long the answer is |

Only `low`, `medium` and `high` are accepted for effort and verbosity: it is the subset every supporting model takes. Provider-specific values such as `minimal`, `xhigh` or `max` are not available.

:::warning
`maxOutputTokens` is a **hard cap**. A longer answer is cut, and the response says so in the provider's own field (`finish_reason: "length"` on OpenAI, `stop_reason: "max_tokens"` on Anthropic). The response is returned unaltered. On models with reasoning or thinking, the cap also covers the reasoning tokens.
:::

## Where it is configured

A call configuration lives on a **router** and on a **routing profile**:

- A router with a bound routing profile uses the **profile's** call configuration. The router's own is ignored until the profile is unbound. There is no field-level merge.
- Otherwise the router's own call configuration applies.

The usage record and the trace tell you which one was in force (`source: "router"` or `"profile"`).

An orchestrator has no call configuration of its own: the configuration of the candidate router that serves the request applies.

## The shape

```json
{
  "enabled": true,
  "clientValues": { "effort": "keep", "maxOutputTokens": "override" },
  "tiers": {
    "low":    { "effort": "low",  "maxOutputTokens": 512,  "verbosity": "low" },
    "medium": { "effort": "medium", "maxOutputTokens": 2048 },
    "high":   { "effort": "high", "maxOutputTokens": 8192, "verbosity": "high" }
  },
  "thresholds": { "mediumFromTokens": 2000, "highFromTokens": 16000 }
}
```

| Field | Description |
|-------|-------------|
| `enabled` | Required. `false` keeps the data but changes nothing on the wire |
| `tiers` | Required, may be empty. Settings for `low`, `medium`, `high`. A tier with no settings changes nothing |
| `clientValues` | Per setting, `keep` (default) or `override`. See [Client values](#client-values) |
| `thresholds` | Estimated input tokens where `medium` and `high` start. Defaults `2000` and `16000`. `mediumFromTokens` must be lower than `highFromTokens` |

Unknown fields are rejected.

## How the tier is chosen

The decision is made once per request, with no extra model call:

1. Estimated input tokens (about 4 characters per token of message text) at or above `highFromTokens`: **high**.
2. Otherwise at or above `mediumFromTokens`, or the request carries tools: **medium**.
3. Otherwise: **low**.

The settings of that tier are then applied to whichever candidate model serves the request. On a fallback, the settings are worked out again for the new model, so a setting written for one candidate never reaches another.

## Client values

When the client already sent the setting, the policy for that setting decides:

| Policy | Behaviour |
|--------|-----------|
| `keep` (default) | The client's value goes through unchanged. The router's value is skipped with reason `client_kept` |
| `override` | The router's value replaces the client's, if the model supports it |

"Client sent it" is read per API shape: `reasoning_effort`, `verbosity`, `max_tokens` or `max_completion_tokens` on Chat Completions; `reasoning.effort`, `text.verbosity`, `max_output_tokens` on Responses; `output_config.effort` and `max_tokens` on Anthropic Messages.

Anthropic Messages requires `max_tokens`, so every Anthropic-lane request has one. Under `keep`, `maxOutputTokens` therefore never applies on that lane; set `clientValues.maxOutputTokens` to `override` to have it take effect.

## Which models get which setting

A setting is sent only when the target model is known to support it. **An unknown model means the setting is not sent**, and the call is recorded with the skip reason `unsupported`. The match is on the upstream model id, so a model id Routerly does not recognise is never sent a setting speculatively.

| Setting | Providers | Applied when |
|---------|-----------|--------------|
| `effort` | `anthropic`, `anthropic-oauth` | The model is on the Anthropic [effort](https://platform.claude.com/docs/en/build-with-claude/effort) list (Opus, Sonnet, Haiku, Fable and Mythos generations 4.5 and later; checked 2026-11-04) |
| `effort` | `openai`, `azure-openai`, `openai-oauth` | The model id starts with `o1` to `o9` or `gpt-5`. `o1-mini`, `o1-preview` and `-chat` variants are excluded |
| `verbosity` | `openai`, `azure-openai`, `openai-oauth` | The model id starts with `gpt-5` (not `-chat` variants) |
| `maxOutputTokens` | `openai`, `azure-openai`, `anthropic`, `anthropic-oauth`, `gemini`, `vertex`, `bedrock`, `ollama`, `custom`, `mistral`, `cohere`, `xai`, `deepseek`, `groq`, `together`, `perplexity` | Always |

Web providers, and `openai-oauth` for `maxOutputTokens`, never receive a setting. The ChatGPT Codex backend behind `openai-oauth` has no documented token-cap parameter, so `maxOutputTokens` is skipped there as `unsupported`.

## What reaches the provider

Each provider gets the setting in its own documented form. Nothing else in the payload, and no header, is changed.

| Provider path | `effort` | `verbosity` | `maxOutputTokens` |
|---------------|----------|-------------|-------------------|
| OpenAI, Azure (API key), any lane | `reasoning_effort` | `verbosity` | `max_tokens`, mapped to `max_completion_tokens` for `o` and `gpt-5` models |
| `openai-oauth` (Responses, Codex backend) | `reasoning.effort` | `text.verbosity` | not sent |
| Anthropic (SDK path) | `output_config.effort` | not supported | `max_tokens` |
| Anthropic and Anthropic OAuth (verbatim forward) | `output_config.effort` added to the client body | not supported | `max_tokens` replaced (only under `override`, see above) |
| Other providers | not supported | not supported | the provider's own token-cap field |

Things to know:

- **OpenAI with an API key gets the Chat Completions forms** (`reasoning_effort`, `verbosity`), even when the client called the Responses API: Routerly converts the request before it reaches the provider. Only `openai-oauth` receives the Responses forms (`reasoning.effort`, `text.verbosity`).
- **Translation works across lanes.** An OpenAI-lane request routed to a Claude model gets `output_config.effort`; an Anthropic-lane request routed to a `gpt-5` model gets `reasoning_effort`.
- **Anthropic thinking and the cap.** For a model with thinking enabled, Routerly normally raises `max_tokens` to at least 16000. When the router applies `maxOutputTokens`, the router's value wins instead, and the thinking `budget_tokens` is kept below it. If the cap is 1024 or less, thinking is **omitted** for that call, because Anthropic needs a budget of at least 1024.
- **Settings are checked per model.** A fallback model that does not support `effort` gets no `effort`; the one before it keeps its own.

## Seeing what was applied

- **Trace.** The `router:call-config` entry shows the tier, the signals (input tokens, tools, message count), the thresholds, the configured values and, per candidate, what would be applied or skipped. The `model:request` entry shows what the attempt actually sent.
- **Usage record.** A call that had a configuration applied carries `callConfig` with `tier`, `source`, `applied` and, when something was not sent, `skipped` (`setting` and `reason`: `client_kept`, `unsupported` or `invalid`). Calls without a configuration have no `callConfig` field.
- **Simulator and MCP.** The router test tab, the Playground and the MCP `route_preview` tool show the decision without calling a provider.

## Configure it

- Dashboard: [Router Routing tab](../dashboard/routers.md#call-configuration) and [Profiles](../dashboard/profiles.md#routing-configuration).
- CLI: [`routerly router call-config`](../cli/commands.md#call-configuration---routerly-router-call-config) and [`routerly profiles`](../cli/commands.md#routerly-profiles-update).
- API: [Call configuration](../api/management.md#call-configuration-router-and-profile-field).

See also [Routing](./routing.md) for how the model is chosen, and [Routers](./routers.md).
