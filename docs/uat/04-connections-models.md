# 04 - Connections and models

Provider connections, model instances, discovery and the model catalog. Real provider credentials are required (see the skill preflight).

Template and judging rules: `.claude/skills/uat-runner/SKILL.md`. Every case below is `never run` until the uat-runner executes it.

### UAT-04-01 - Create a connection
**Surfaces:** cli, dashboard, service
**Preconditions:** Real provider key available
**Steps:**
1. `routerly connections add --provider-name <p> --api-key <k> --label uat`.
2. Dashboard Connections, `GET /api/connections`.
**Expected:** Connection appears on all surfaces; the API key is never returned in clear text in list responses.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-02 - Edit, disable and remove a connection
**Surfaces:** cli, dashboard
**Preconditions:** A connection exists
**Steps:**
1. `routerly connections edit <id> --no-enabled`, then `--enabled`, then `remove <id>`.
**Expected:** State follows each command; removing a connection used by a model is rejected or reported clearly.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-03 - Provider-specific connection fields
**Surfaces:** dashboard, cli
**Preconditions:** None
**Steps:**
1. Open the connection form for Azure, AWS Bedrock and Vertex; compare with `routerly connections add --help` flags (`--azure-*`, `--aws-*`, `--vertex-*`).
**Expected:** Each provider shows its required fields in the dashboard and the CLI exposes the equivalent flags.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-04 - Discover models from a live provider
**Surfaces:** cli, dashboard
**Preconditions:** Connection with a real key
**Steps:**
1. `routerly model discover --provider <p> --json`.
2. Dashboard: Models, discovery page.
**Expected:** Both list the provider's current models; the JSON output is parseable.
**Real-provider proof:** Listing contains the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-05 - Add a model with pricing and budgets
**Surfaces:** cli, dashboard, service
**Preconditions:** Connection exists
**Steps:**
1. `routerly model add <id> --connection <c> --input-price 1 --output-price 2 --daily-budget 5 --monthly-budget 50`.
2. Dashboard Models, `GET /api/models`.
**Expected:** Model shows the same prices and budgets on every surface.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-06 - Edit and remove a model
**Surfaces:** cli, dashboard
**Preconditions:** A model exists
**Steps:**
1. `routerly model edit <id> --input-price 3`, then `routerly model remove <id>`.
**Expected:** Edit persists; removal of a model referenced by a router is rejected or reported clearly.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-07 - Model catalog
**Surfaces:** service, dashboard
**Preconditions:** Service has outbound access
**Steps:**
1. `GET /api/catalog/status`, `POST /api/catalog/refresh`, `GET /api/models/catalog`.
2. `routerly catalog repos list --json`.
**Expected:** Catalog status reports a refresh time; refresh succeeds; repositories list is parseable.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-08 - Add and disable a catalog repository
**Surfaces:** cli
**Preconditions:** None
**Steps:**
1. `routerly catalog repos add <url>`, `disable <url>`, `enable <url>`, `remove <url>`, `refresh`.
**Expected:** Each step is reflected in `repos list --json`.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-09 - API key reveal is permission-gated
**Surfaces:** service
**Preconditions:** User without the permission for `GET /api/models/:id/apikey`
**Steps:**
1. Call the endpoint with that user's token and then with an admin token.
**Expected:** 403 for the first, key returned for the second.
**Real-provider proof:** n/a (no provider call)
**Last run:** never run - BLOCKED - evidence: -

### UAT-04-10 - Real call through a configured model
**Surfaces:** service
**Preconditions:** Model on a real connection, router with that model, router token
**Steps:**
1. `POST /v1/chat/completions` with the router token, a one-word prompt.
**Expected:** HTTP 200 and a normal completion body.
**Real-provider proof:** Response carries the provider's own echoed model string and a non-zero token usage count that the fake upstream of the discarded run could not produce.
**Last run:** never run - BLOCKED - evidence: -
