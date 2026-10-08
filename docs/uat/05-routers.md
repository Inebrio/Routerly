# 05 - Routers

Standard routers: CRUD, routing policies, target models, tokens, limits and routing decisions. Orchestrator and Passthrough have their own areas.

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-05-01 - Create a router
**Surfaces:** cli, dashboard, service
**Preconditions:** Models exist
**Steps:**
1. `routerly router create <name> --kind router --timeout 60000`.
2. Dashboard Routers, Router tab, New Router; `GET /api/routers`.
**Expected:** Router appears under the Router tab and in the API with kind `router`; the creation form has no kind selector.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-02 - Edit and delete a router
**Surfaces:** cli, dashboard
**Preconditions:** A router exists
**Steps:**
1. `routerly router edit <id> --name x`, dashboard General tab, `routerly router remove <id>`.
**Expected:** Edits persist; delete removes the router and its tokens.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-03 - Router list is grouped by kind
**Surfaces:** dashboard
**Preconditions:** One router of each kind
**Steps:**
1. Open Routers and click Router, Orchestrator, Passthrough tabs.
**Expected:** Each tab shows only routers of its kind; there is no All tab.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-04 - Add, reorder and remove target models
**Surfaces:** cli, dashboard
**Preconditions:** Router and two models
**Steps:**
1. `routerly router model add <router> <model>`, `model reorder`, `model remove`; same in the Routing tab.
**Expected:** Order and membership match across CLI, dashboard and `GET /api/routers`.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-05 - Per-model system prompt
**Surfaces:** cli, service
**Preconditions:** Router with a model
**Steps:**
1. `routerly router model set-prompt <router> <model> --prompt 'Answer in one word'`.
2. Send a request through the router.
**Expected:** Upstream request contains the configured prompt exactly once; the client payload is otherwise unchanged.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-06 - Enable, disable and reorder routing policies
**Surfaces:** cli, dashboard
**Preconditions:** Router with two models
**Steps:**
1. `routerly router routing policy enable <router> <type>`, `disable`, `reorder`; Routing tab.
**Expected:** The policy list and its order match on both surfaces; disabled policies do not influence routing.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-07 - Fallback models and auto-routing
**Surfaces:** cli
**Preconditions:** Router with three models
**Steps:**
1. `routerly router routing update <router> --fallback-models a,b --auto-routing`; then `--no-auto-routing`.
**Expected:** `router show --json` reflects the settings; with the primary failing the request is served by a fallback.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-08 - Create a router token with scopes and limits
**Surfaces:** cli, dashboard, service
**Preconditions:** Router exists
**Steps:**
1. `routerly router token create <router> --labels ci --scopes chat --tag t1`.
2. `router token edit ... --add-limit` / `--remove-limit`.
3. Use the token on `/v1/chat/completions`.
**Expected:** Token is shown once; requests count against the limit; a request over the limit is refused with a provider-shaped error.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-09 - Revoke a router token
**Surfaces:** cli, service
**Preconditions:** A token in use
**Steps:**
1. `routerly router token remove <router> <token-id>`, then retry the request.
**Expected:** The request fails authentication.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-10 - Budget enforcement
**Surfaces:** service
**Preconditions:** Model with a tiny `--daily-budget`
**Steps:**
1. Send requests until the budget is exceeded.
**Expected:** Requests beyond the budget are refused or rerouted according to policy; usage records show the spend.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-05-11 - Routing decision follows policy
**Surfaces:** service
**Preconditions:** Two models with different prices, `cheapest` policy enabled
**Steps:**
1. Send ten requests.
**Expected:** All requests go to the cheaper model; usage records name the model that served each request.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -
