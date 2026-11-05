# Compare prices of the same model across providers

Several providers sell access to the same model, and the list price often differs. This guide shows how to find those offers with the tools Routerly already has, how to turn list prices into a cost for your own workload, and where list prices stop being a reliable guide.

Routerly does not group offers automatically. Model ids differ per provider (`gpt-oss-120b`, `openai/gpt-oss-120b`, `accounts/fireworks/models/gpt-oss-120b`), so you search, filter and judge equivalence yourself. The rules for that judgment are in [Decide whether two offers are the same](#decide-whether-two-offers-are-the-same).

## Three different prices

| Price | Where it comes from | Where you see it |
|-------|--------------------|------------------|
| **Published catalog price** | The provider catalog Routerly fetches at runtime. A snapshot of list prices, dated by the catalog, not a live quote. | **Models › Discover**, `routerly model discover`, `GET /api/models/catalog` |
| **Custom price** | The price stored on a model you registered. Pre-filled from the catalog when you click **Add**, and editable (negotiated rates, regional or reserved pricing). | **Models** page (Input, Output, Cache columns), model edit form |
| **Effective cost** | What Routerly records for each call: tokens actually used multiplied by the registered model's prices. | **Usage** page, usage reports |

Only the effective cost reflects your real traffic. The catalog price is a starting point; the custom price is what Routerly uses for budgets and routing decisions.

## What Discovery shows

Open **Models**, then **Discover** (`/dashboard/models/discover`).

- **Search** matches the model id or name, so searching a family name such as `gpt-oss-120b` lists every provider that carries an entry containing it.
- **Provider** is a multi-select: pick the two or three providers you want side by side.
- **Input /1M** and **Output /1M** headers sort ascending, then descending on a second click.
- **Show › Configured only** limits the list to models you already registered.
- **Context** and the **Price /1M** tier filters narrow further.

Discovery shows input and output price and the context window. It does **not** show the cache price or the endpoint. The cache price is visible in the model form and on the Models page once you add the model (see [Cache](#cache)).

From the CLI and the API:

```bash
routerly model discover --provider groq
routerly model discover --provider fireworks --json
curl -s http://localhost:3000/api/models/catalog -H "Authorization: Bearer $TOKEN"
```

Watch the units: the dashboard shows prices **per 1M tokens**, while the CLI table and the JSON of the API use **per 1K tokens** (`inputPer1kTokens`, `outputPer1kTokens`). Multiply by 1000 to compare with the dashboard.

All three require the `model:read` permission. A user without it gets `403 Required permission: model:read`.

## Decide whether two offers are the same

Similar names are not enough. Treat two offers as the same only when you can confirm all of the following on the provider pages:

1. **Same model and version.** The vendor publishes both under the same model name and release, not just a similar one.
2. **Same variant.** `preview`, `fast`, `mini`, `lite`, reasoning-effort levels and `-instruct` suffixes are different offers. Do not compare `gpt-4o` with `gpt-4o-mini`, or a model with its `preview` build.
3. **Same endpoint class.** Direct vendor API, a cloud marketplace (Azure OpenAI, Amazon Bedrock, Google Vertex AI) and a third-party host of an open-weights model are different services. Region, data-zone, throughput tier and batch/priority tiers change both price and behaviour.
4. **Same limits that matter to you.** Context window, maximum output, supported modalities, tool calling and rate limits.
5. **For hosted open-weights models**, also the numeric precision and serving configuration the host uses, when the host documents it.

Two more rules:

- **Unknown stays unknown.** A context window shown as `—` in the dashboard (`0` in the CLI and API) means the catalog does not state it; it does not mean zero. A missing cache price means the catalog has no cache price, not that caching is free. Look it up before you compare.
- **`$0` is not always free.** Subscription logins (`openai-oauth`, `anthropic-oauth`) appear in the catalog with zero price because usage is covered by a subscription, not billed per token. Do not compare them with per-token offers.

## Worked example: `gpt-oss-120b`

Catalog snapshot **2026-10-26** (the `updatedAt` of the provider catalog index in [Routerly-Providers](https://github.com/Inebrio/Routerly-Providers)). Prices in USD per 1M tokens.

| Provider | Model id in Routerly | Input | Output | Context |
|----------|----------------------|-------|--------|---------|
| groq | `openai/gpt-oss-120b` | 0.15 | 0.60 | 128k |
| together | `gpt-oss-120b` | 0.15 | 0.60 | not stated |
| fireworks | `accounts/fireworks/models/gpt-oss-120b` | 0.15 | 0.60 | not stated |
| cerebras | `gpt-oss-120b` | 0.35 | 0.75 | 131k |

To reproduce it: **Models › Discover**, search `gpt-oss-120b`, sort by **Input /1M**; or

```bash
routerly model discover --json | jq '.[] | select(.id | test("gpt-oss-120b")) | {provider, id, pricing, contextWindow}'
```

### Cost on a declared workload

Declare the workload first. Example: 10,000 requests per month, 2,000 input tokens and 500 output tokens each, no caching.

```
input tokens  = 10,000 x 2,000 = 20M
output tokens = 10,000 x   500 =  5M
cost = 20 x input_price + 5 x output_price
```

| Provider | Calculation | Monthly list-price cost |
|----------|-------------|-------------------------|
| groq | 20 x 0.15 + 5 x 0.60 | $6.00 |
| cerebras | 20 x 0.35 + 5 x 0.75 | $10.75 |

This is arithmetic on list prices, not a measurement. It says nothing about speed, quality at the host's serving configuration, availability or rate limits, and it is not a statement of savings. To measure, register both models, send the same prompts through each, and read the **Usage** page: tokens and cost are recorded per call.

## Cache

When a provider supports prompt caching, repeated input tokens are billed at a lower **cache** price. The catalog stores it, but Discovery does not display it. In the new-model form, the **Cache** field is pre-filled when the catalog has a cache price for that model, and is empty otherwise. Check it before you rely on it. The registered model shows it in the **Cache** column of the Models page, where it can be sorted and edited.

With a cache hit ratio `h` (fraction of input tokens served from cache):

```
input cost = input_tokens x ((1 - h) x input_price + h x cache_price)
```

Use the cache price only for providers that publish one for the model; for the others it is unknown, so compare them on the non-cached price and say so.

## From comparison to routing

Once two offers are registered as models, the `cheapest` routing policy and fallbacks work on their registered (custom) prices. See [Routing](../concepts/routing.md) and [Models and prices](../concepts/models.md).

## Sources and verification

- Price figures: Routerly provider catalog, snapshot 2026-10-26, as returned by `GET /api/models/catalog` on Routerly 0.6.x. The catalog is community-maintained and can lag a provider's own pricing page.
- Before you decide, confirm the price, version and limits on each provider's official pricing page; prices change without a Routerly release.
