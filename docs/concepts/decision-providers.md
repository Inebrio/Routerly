---
title: Decision providers
sidebar_position: 8
---

# Decision providers

A **decision model** does not generate text. It receives some content and one or more questions with predefined answers, and returns the chosen answer. TypeSafe AI (`jev-latest`) is the first decision provider. Routerly uses the model as a building block for internal decisions; it never serves chat requests.

## Configure a decision provider

A decision provider is configured like any other provider: a connection with the API key, then a model on that connection.

```bash
routerly connections add --provider-id typesafe --label "TypeSafe" --api-key <key>
routerly model add --id jev-latest --provider typesafe --api-key <key> --input-price 0 --output-price 0
```

In the dashboard use **Connections › Add** and **Models › Add** (or **Models › Discover**) with the provider `typesafe`. The default endpoint is `https://api.typesafe.ai/v1`.

The model gets `capabilities.decision: true` from its provider. The flag is not editable. The dashboard shows a "Decision model" notice in place of the embedding checkbox, and Discover shows a "Decision" badge.

Content you send to a decision model leaves your infrastructure for the vendor. Check the vendor's data terms before enabling it.

## Test a decision

`POST /api/models/:id/test` (dashboard: **Test** on the model page; the CLI has no model test command) sends a one-question probe to the decision endpoint. The result is `{ "ok": true, "latencyMs": … }`, or `{ "ok": false, "error": "…" }` with the vendor HTTP status when the key is wrong or the endpoint is unreachable.

## Routing and availability

- A decision model is never a chat candidate. If a router lists one, it is skipped when the request is routed, a warning is logged and the router save response warns about it. A router that holds only decision models cannot serve requests.
- Chat model pickers in the dashboard (routing, security rules, optimizer, experiments, profiles) do not list decision models.
- Failures of a decision model never fail a client request: callers use a non-throwing wrapper and fall back to the existing behaviour.
- Permissions are the existing `connections:*` and `model:*` ones.
