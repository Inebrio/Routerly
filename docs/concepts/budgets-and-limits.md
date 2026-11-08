---
title: Budgets & Limits
sidebar_position: 6
---

# Budgets & Limits

Routerly has a three-level budget hierarchy that lets you control spending per model, per router and per individual token. Budgets can be configured for any metric — cost, call count, or token usage — over a rolling or calendar window.

---

## Budget Hierarchy

```
Model budget (global)
└── Router budget (per model of the router)
    └── Per-token budget (per model of the token)
```

A request must pass **all** applicable budget checks before Routerly forwards it to a provider. If every candidate model of the router is over a limit, Routerly returns `429` with the error format of the lane the client used (see [What Happens When a Budget Is Exhausted](#what-happens-when-a-budget-is-exhausted)).

:::caution Passthrough routers are not covered
None of the budget or limit checks on this page apply to **Passthrough** routers. A Passthrough router forwards the request with the client's own upstream credential and no model resolution, so Routerly has no price to attribute — usage records for that traffic always show `cost: null`. Set budgets on the model or token as usual for regular routers; a Passthrough router bypasses them entirely, by design, regardless of any budget configured elsewhere in the account.
:::

### Level matrix

| Level | Set on | Surfaces | Inherits from | Override |
|-------|--------|----------|---------------|----------|
| Model | the model (`limits`) | Dashboard (Models), CLI (`model add\|edit`), API | none: it is the base | none |
| Router | the router's entry for that model (`limits`, `limitsMode`) | `routers.json` only | model | `replace` (default), `extend`, `disable` |
| Token | the token's entry for that model (`limits`, `limitsMode`) | Dashboard (router → Tokens), CLI (`router token edit --add-limit`), API; `limitsMode` only in `routers.json` | router, then model | `replace` (default), `extend`, `disable` |

A level with no limits and no mode is transparent: the limits of the level above apply unchanged. Each level counts its own usage: a token limit counts that token's calls, a router limit counts the calls of the whole router.

---

## Budget Levels

### Global budget

Applies to every request that uses the model, across all routers. It is the base every other level inherits.

Set on the model: **Models** → edit the model → **Limits**, or `routerly model add|edit --limits-json`.

### Router budget

Applies to requests a router sends to one of its models (`limits` on the model entry of the router). It has no dashboard or CLI editor: write it in `routers.json` (see the note under Configuring Budgets).

### Per-token budget

Applies to requests made with a specific router token. Configured in the router's **Tokens** tab. Per-token limits are useful when different applications share a router and you want to isolate their spending.

### Teams, organisations and SSO groups

There are no organisation or team budget objects. A **team** is a convention: one router (or a few) with one token per application. The team cap is the per-token, router or model limit above; nothing sums spend across several routers.

| Capability | Status |
|------------|--------|
| Limits on model, router (per model), token (per model) | Available, enforced on every request |
| Parent/child inheritance between those levels (`replace`, `extend`, `disable`) | Available, see [Limit Modes](#limit-modes-per-router-and-per-token-budgets) |
| Organisation / team spend groups with their own limits | Not available |
| Team membership | Local only: a user is assigned to routers by an admin (`--routers`, `router member add`) |
| Login with an identity provider and mapping of IdP groups to teams or budgets | Not available (dashboard users are local accounts) |

Budgets and identity are independent: a limit never depends on who the user is or which IdP group they would belong to.

---

## Metrics

Each budget limit tracks one metric:

| Metric | Description |
|--------|-------------|
| `cost` | USD cost calculated from token prices |
| `calls` | Total number of API requests |
| `input_tokens` | Total input tokens consumed |
| `output_tokens` | Total output tokens generated |
| `total_tokens` | Sum of input and output tokens |

---

## Window Types

Budgets reset based on the configured window type.

### Period windows

Reset at the start of each calendar period:

| Window | Resets |
|--------|--------|
| `hourly` | Top of each hour |
| `daily` | Midnight (UTC) |
| `weekly` | Monday midnight (UTC) |
| `monthly` | 1st of each month |
| `yearly` | January 1st |

### Rolling windows

Track usage over a sliding time window:

| Window | Period |
|--------|--------|
| `rolling_second` | Last 1 second |
| `rolling_minute` | Last 60 seconds |
| `rolling_hour` | Last 3,600 seconds |
| `rolling_day` | Last 86,400 seconds |
| `rolling_week` | Last 7 days |
| `rolling_month` | Last 30 days |

---

## Limit Modes (per-router and per-token budgets)

The `limitsMode` of a router entry or a token entry controls how its limits interact with the level above (model, then router). A level with no limits and no mode is transparent:

| Mode | Behaviour |
|------|-----------|
| `replace` (default) | This level's limits override the inherited ones entirely |
| `extend` | This level's limits stack on top of the inherited ones (all must pass) |
| `disable` | No budget limit at all for this level and below, regardless of inherited limits |

---

## Configuring Budgets

### Dashboard

**Global budget (per model):** Open **Models**, edit the model, then the **Limits** section.
**Per-token budget:** Open the router → **Tokens** tab → click the edit icon next to a token. The editor shows the limit inherited from the model so you can see what you are overriding.

### CLI

Global limits are set on the model. `model add` has two cost shorthands; `model edit` takes the full limits array:

```bash
routerly model add --id gpt-5-mini --provider openai --connection my-openai --daily-budget 5.00 --monthly-budget 50.00

routerly model edit gpt-5-mini --limits-json \
  '[{"metric":"cost","windowType":"period","period":"monthly","value":100},
    {"metric":"calls","windowType":"rolling","rollingAmount":1,"rollingUnit":"minute","value":60}]'
```

Per-token limits are set on the token, one spec per model:

```bash
routerly router token edit "My App" <token-id> \
  --add-limit "gpt-5-mini:cost:period:daily:5"
```

The mode (`replace` by default, `extend` or `disable`, see Limit Modes) is set per model, with the CLI `--limits-mode "gpt-5-mini:extend"` (repeatable), with the **Limits mode** selector on the dashboard token editor, or with `limitsMode` on the model entry of `PUT /api/routers/:id/tokens/:tokenId` (400 for any other value).

:::note
The router level (`limits` on a router's model entry) is honoured at request time but has no dashboard or CLI editor yet: it can only be written directly in `routers.json`. Set budgets on the model or on the token instead.
:::

---

## What Happens When a Budget Is Exhausted

Routerly skips a model that is over any applicable limit and tries the next one. When none is left it answers **HTTP 429** without calling a provider, in the error format of the lane:

- OpenAI lane (`/v1/chat/completions`, streaming or not): `{"error":{"message":"Usage limit exceeded for every model of this router.","type":"insufficient_quota"}}`
- Anthropic lane (`/v1/messages`): `{"type":"error","error":{"type":"rate_limit_error","message":"Usage limit exceeded for every model of this router."}}`

Once the window resets (for example at the start of next month), requests are accepted again. Blocked requests do not appear in usage reports.

---

## Worked example: two teams

Two teams share one OpenAI account. Each gets a router and a token; the support team is capped at 1,000 calls a month, research at 200.

```bash
routerly model add --id gpt-5-mini --provider openai --connection my-openai --input-price 0.25 --output-price 2

routerly router create --name support
routerly router model add support gpt-5-mini
routerly router token create support              # prints the token once; note its id
routerly router token edit support <support-token-id> \
  --add-limit "gpt-5-mini:calls:period:monthly:1000"

routerly router create --name research
routerly router model add research gpt-5-mini
routerly router token create research
routerly router token edit research <research-token-id> \
  --add-limit "gpt-5-mini:calls:period:monthly:200"
```

Each team calls Routerly with its own token. The 201st research call in a month gets `429` while support keeps working. The token limit replaces any router or model limit for that model (mode `replace`); it does not add the two teams together. To see usage per team: `routerly report usage --router research`.

---

## Notifications

You can configure Routerly to send an alert when a budget reaches a configured threshold (e.g. 80% used) or when it is exhausted. See [Concepts: Notifications](./notifications.md) for setup.
