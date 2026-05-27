# Workflow: Feature Development

## Step 0 — Identify the scope

Determine which package(s) the feature touches and read the corresponding agent file:

| Package | Agent |
|---------|-------|
| `packages/service/` | `ai/agents/service.md` |
| `packages/dashboard/` | `ai/agents/frontend.md` |
| `packages/cli/` | `ai/agents/cli.md` |
| `docs/` | `ai/agents/docs.md` |
| Cross-cutting | read all affected agent files |

## Step 1 — Gather context

Read in order (skip what is irrelevant to the scope):

1. `ai/memory/constraints.md` — what you must never do
2. `ai/context/architecture.md` — where the feature fits in the request flow
3. `ai/context/api.md` — if adding/changing endpoints
4. `ai/context/database.md` — if touching config files
5. `ai/policies/coding-style.md` — naming and import conventions
6. `ai/policies/security.md` — if touching auth, tokens, or user input

## Step 2 — Plan

Before writing code, answer:

- What files will be created or modified?
- Does this add a new endpoint? → check `ai/context/api.md` for conflicts
- Does this add a new routing policy? → register in `router.ts` + `RoutingPolicy` enum
- Does this add a new provider? → implement `ProviderAdapter` + register in `providers/index.ts`
- Does this change a shared type? → list all affected packages
- Which other agents need a handoff when this is done?

## Step 3 — Implement

Order of changes:

1. **`packages/shared/src/`** — add or update types first (everything else depends on them)
2. **`packages/service/src/`** — core logic, routes, policies, providers
3. **`packages/cli/src/`** — new command or updated API call if applicable
4. **`packages/dashboard/src/`** — new page or API call in `api.ts` if applicable
5. **`docs/`** — documentation (or hand off to the Docs agent)

Implementation rules:
- Imports use `.js` extension; builtins use `node:` prefix
- Config writes via `writeConfig()` only
- Zod validation on all new HTTP inputs
- Permission check on all new management endpoints
- Wire format to client never altered

## Step 4 — Tests

Write `*.test.ts` in the same directory as each new/changed file.

Minimum coverage per change type:

| Change | Tests required |
|--------|---------------|
| New routing policy | happy path + empty candidates + equal scores |
| New provider | request translation + error propagation + streaming path |
| New management endpoint | 200 valid auth · 401 missing auth · 403 wrong permission · 400 invalid body |
| New config accessor | file present · file missing · concurrent write |
| New shared utility | all branches |

Run before finishing:
```bash
npm test --workspace=packages/<affected-package>
npm run typecheck
npm run lint
```

> **BLOCKING**: The task is not complete until all three commands exit green. If `npm test` fails, fix the failures before proceeding to Step 5. Do not skip this step.

### Dashboard changes — additional browser verification (BLOCKING)

After `npm run typecheck` passes, dashboard changes require a real-browser verification step before the task is complete:

1. `npm run dev` — start the service (dashboard at `http://localhost:3000/dashboard/`)
2. Open the dashboard in a browser and navigate to the changed page/feature
3. Exercise the functionality: fill forms, trigger validation, verify data loads, check error states
4. Capture a screenshot as evidence
5. Stop the dev server

| Change | What to verify |
|--------|----------------|
| New page | renders · navigation link works · data loads |
| New form | fields visible · validation on empty submit · success state |
| New component | visible · interactions behave correctly |
| Visual/CSS change | appearance correct · no regressions elsewhere |
| Routing change | correct page per URL · protected routes redirect unauthenticated |

## Step 5 — Handoffs

After implementation, send a handoff message to each affected agent:

```
HANDOFF → <AgentName>
Changed: <what changed>
Action needed: <what the other agent must do>
Files: <relevant file paths>
```

Examples:
- Service → Docs: "New endpoint `POST /api/notifications/test`. Update `docs/api/management.md`."
- Service → CLI: "New endpoint `POST /api/models/bulk-disable`. Add `routerly model bulk-disable` command."
- Service → Frontend: "New field `budgetAlert` in `projects.json` schema. Expose in ProjectFormPage."
- CLI → Docs: "New command `routerly report --format csv`. Update `docs/cli/commands.md`."

## Step 6 — Commit

Use conventional commits (lowercase):
```
feat(service): add semantic-cache flush endpoint
feat(cli): add routerly cache flush command
docs: document cache flush endpoint and command
```

One commit per package when changes span multiple packages.
