# Workflow: Feature Development

## Before you start — autoimprove pre-task review

Run Hook 1 from `ai/skills/autoimprove/SKILL.md`:
1. Check `ai/learnings/` for pending entries whose `**Area**` matches this task
2. Read any `high` or `critical` priority entries before writing code
3. If `ai/learnings/` is empty or absent, skip and proceed

---

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
5. **`docs/`** — update the relevant documentation files using the trigger table in `ai/agents/docs.md`; this step is **BLOCKING** — do not skip it

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

### Service changes — additional E2E tests (BLOCKING)

For any change that touches `packages/service/src/routes/`, `routing/`, `providers/`, or `config/`, run the E2E suite after unit tests:

```bash
# Terminal 1 — start the service (if not already running)
npm run dev

# Terminal 2 — run E2E tests
npm run test:e2e
```

Prerequisites: `.env` file populated from `.env.example` (credentials loaded automatically).
Both `E2E · LLM Proxy` and `E2E · Management API` suites must pass.

> **BLOCKING**: E2E tests must pass before declaring a service task complete.

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

## Step 4.5 — Autoimprove post-task capture

Run Hook 2 from `ai/skills/autoimprove/SKILL.md` before moving to handoffs:
- Any test failed unexpectedly before you fixed it? → `ai/learnings/ERRORS.md`
- User corrected you during this task? → `ai/learnings/LEARNINGS.md` (correction)
- You used a wrong import, type, or API? → `ai/learnings/LEARNINGS.md` (knowledge_gap)
- A doc in `ai/` was outdated? → update doc + `ai/learnings/LEARNINGS.md` (knowledge_gap)
- You found a better approach? → `ai/learnings/LEARNINGS.md` (best_practice)
- Any learning broadly applicable? → promote to `ai/memory/` or entrypoint files

---

## Step 5 — Documentation update (BLOCKING)

Before committing, update all documentation files affected by your changes. Use the trigger table in `ai/agents/docs.md` to identify which files to touch.

| You changed | Docs files to update |
|-------------|---------------------|
| New/changed `/api/*` endpoint | `docs/api/management.md`, `docs/service/endpoints.md` |
| New/changed `/v1/*` or `/anthropic/*` proxy | `docs/api/llm-proxy.md` |
| New routing policy | `docs/concepts/routing.md`, `docs/service/routing-engine.md` |
| New provider | `docs/concepts/providers.md`, `docs/service/providers.md` |
| Changed config file schema | `docs/reference/config-files.md` |
| New CLI command | `docs/cli/commands.md` |
| Changed CLI flags or output | `docs/cli/commands.md` |
| New dashboard page | matching file in `docs/dashboard/` |
| Changed setting exposed in UI | `docs/dashboard/settings.md` |

> **BLOCKING**: The task is not complete until all relevant docs files are updated. Do not commit without updating the docs.

## Step 5.5 — Cross-agent handoffs

For changes that require another agent (not Docs) to act:

```
HANDOFF → <AgentName>
Changed: <what changed>
Action needed: <what the other agent must do>
Files: <relevant file paths>
```

Examples:
- Service → CLI: "New endpoint `POST /api/models/bulk-disable`. Add `routerly model bulk-disable` command."
- Service → Frontend: "New field `budgetAlert` in `projects.json` schema. Expose in ProjectFormPage."
- CLI → Service: verify endpoint exists before adding api.ts call.

## Step 6 — Commit

Use conventional commits (lowercase):
```
feat(service): add semantic-cache flush endpoint
feat(cli): add routerly cache flush command
docs: document cache flush endpoint and command
```

One commit per package when changes span multiple packages.

> If commitlint rejects the message only because of an uppercase character inside a technical identifier (a type name, an acronym, a field name) that cannot be written in lowercase without losing meaning, use `--no-verify` and explain the reason in the commit body. This is an exception, not the norm.

## Step 7 — Push and open a PR

`develop` is a **protected branch** — direct pushes are rejected. Every feature must go through a pull request.

1. **Push the feature branch** to the remote:
   ```bash
   git push origin feature/<name>
   ```

2. **Open the PR** with the `gh` CLI (pre-authenticated in this repo):
   ```bash
   gh pr create \
     --base develop \
     --head feature/<name> \
     --title "<conventional-commit-title>" \
     --body "$(cat <<'EOF'
   ## Summary
   <what this PR does>

   ## Packages affected
   - `packages/<name>`

   ## Testing
   - `npm test --workspace=packages/<name>` → N/N pass
   - `npm run typecheck` → clean
   EOF
   )"
   ```

3. **Monitor CI** — the "Build & Typecheck" check must go green before the PR can be merged. If it fails, push a fix commit to the same branch.

4. **Do not merge manually** — wait for review/CI, then merge via the GitHub UI or `gh pr merge`.
