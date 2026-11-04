---
title: Use OmniRoute as an upstream
sidebar_label: OmniRoute
sidebar_position: 6
---

# Use OmniRoute as an upstream

[OmniRoute](https://omniroute.online) is an open-source gateway that exposes many model providers behind one OpenAI-compatible endpoint. Routerly treats it as a source of models, like any other OpenAI-compatible provider: you register it as a `custom` connection, and routing, budgets, guardrails, roles and usage reporting apply to its models as usual.

## Prerequisites

- A running OmniRoute instance reachable from the Routerly service. OmniRoute needs Node.js `>=22.22.2 <23` or `>=24 <27`.
- An OmniRoute API key (created in the OmniRoute dashboard, Endpoints page). By default OmniRoute serves its API at `http://localhost:20128/v1`.
- Check it first: `curl -H "Authorization: Bearer $OMNIROUTE_KEY" http://localhost:20128/v1/models`.

## Create the connection

CLI:

```bash
routerly connections add --provider-id custom --provider-name omniroute --label "OmniRoute" \
  --endpoint http://localhost:20128/v1 --api-key "$OMNIROUTE_KEY"
```

Dashboard: **Connections › Add**, provider **Custom**, provider name `omniroute`, the endpoint above and the API key. Then use **Test** on the connection.

Models created on this connection get the `omniroute/` ID prefix (for example `omniroute/auto`); the part after the prefix is the model id OmniRoute receives.

## Add models

Add the models you want to route to, one per OmniRoute model id. Routerly sends the part after the `omniroute/` prefix to OmniRoute, so `omniroute/auto` calls the OmniRoute alias `auto`:

```bash
routerly model add --id omniroute/auto --provider custom --connection omniroute \
  --input-price 0 --output-price 0
```

OmniRoute aliases are virtual models without a price. Set `--input-price` and `--output-price` yourself if you want Routerly's cost tracking and budgets to reflect what you pay; with price 0 the usage rows show tokens and a cost of 0.

## Model ids

Routerly does not list the models of a custom endpoint: register each one by hand (`routerly model discover` browses the built-in catalog, not OmniRoute). Use ids OmniRoute resolves unambiguously: an alias such as `auto` or `auto/best-coding`, or a provider-prefixed id such as `ds/deepseek-v4-flash`. A bare upstream id that several OmniRoute providers serve (for example `deepseek-chat`) is rejected by OmniRoute with a 400 `Ambiguous model` error.

A router chooses among its own target models; the `model` field of the client request does not select one.

## What OmniRoute returns differently

Routerly returns OmniRoute's response as received, so clients see these differences from a first-party provider:

- The response `id` is a UUID, not an OpenAI `chatcmpl-…` or Anthropic `msg_…` id (the streamed `/v1/messages` lane uses `msg_<uuid>`).
- The response `model` is the model OmniRoute actually used (for example `deepseek-v4-pro` when you called `auto`), not the id you requested.
- Reasoning models return `reasoning_content` next to `content`; streamed chunks carry `content: null` while reasoning.
- `usage` may include extra keys (`cached_tokens`, `reasoning_tokens`). Routerly records the prompt and completion tokens it reads from it.
- Errors keep OmniRoute's own body, for example `{"error":{"type":"invalid_request_error","code":"bad_request",…}}` with status 400 for an unknown model.

## Notes

- Streaming and non-streaming calls on both `/v1/chat/completions` and `/v1/messages` go through the generic OpenAI-compatible adapter.
- Aliases have no price, so cost is 0 unless you set prices on the model.
- Secure the OmniRoute instance itself: by default it listens on all interfaces, and it did not reject a wrong key on `/v1/chat/completions` in the tested version (3.8.52) although `/v1/models` required one. Bind it to loopback or put it behind your network controls, and let only Routerly reach it.
