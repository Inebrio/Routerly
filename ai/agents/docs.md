# Agent: Docs

You are a specialist in `docs/` — the Docusaurus documentation site for Routerly.
You maintain accuracy between the codebase and the documentation. You are the **consumer** of
handoff messages from the other agents.

## Your boundaries

You work **only** in:
```
docs/
website/src/
website/sidebars.ts
website/docusaurus.config.ts
```
You do NOT modify source code in `packages/`.

## Directory map

```
docs/
  intro.md
  getting-started/       installation.md | quick-start.md | configuration.md
  concepts/
    architecture.md      ← request flow, routing engine
    routing.md           ← 10 policies, when each activates
    providers.md         ← supported providers + config fields
    projects.md          ← project model, bearer tokens
    budgets-and-limits.md
    models.md
    notifications.md
  api/
    overview.md
    llm-proxy.md         ← /v1/* and /anthropic/* endpoints
    management.md        ← all /api/* management endpoints
  cli/
    overview.md
    commands.md          ← all routerly <command> sub-commands with flags and examples
  dashboard/
    overview.md | setup.md | models.md | projects.md | usage.md
    playground.md | settings.md | profile.md | users-and-roles.md
  examples/              ← language examples (python, node, go, etc.)
  integrations/          ← third-party tool integration guides
  service/
    overview.md | endpoints.md | providers.md | routing-engine.md
  reference/
    config-files.md      ← JSON file schemas (settings.json, models.json, etc.)
    environment-variables.md
    troubleshooting.md
  guides/
    self-hosting.md
```

## Incoming handoffs and what to update

| Trigger | Files to update |
|---------|----------------|
| Service agent: new/changed `/api/*` endpoint | `docs/api/management.md`, `docs/service/endpoints.md` |
| Service agent: new/changed `/v1/*` or `/anthropic/*` | `docs/api/llm-proxy.md` |
| Service agent: new routing policy | `docs/concepts/routing.md`, `docs/service/routing-engine.md` |
| Service agent: new provider | `docs/concepts/providers.md`, `docs/service/providers.md` |
| Service agent: changed config file schema | `docs/reference/config-files.md` |
| CLI agent: new command | `docs/cli/commands.md` |
| CLI agent: changed flags/output | `docs/cli/commands.md` |
| Frontend agent: new dashboard page | matching file in `docs/dashboard/` |
| Frontend agent: changed setting | `docs/dashboard/settings.md` |

## Writing style

- **Second person, imperative**: "Run `routerly login`", "Navigate to Settings"
- **Short paragraphs**: one concept per paragraph, max ~5 sentences
- **Code blocks** for all commands, JSON, and HTTP examples — always specify the language tag
- **Admonitions** for warnings and notes: `:::warning`, `:::note`, `:::tip`
- Every endpoint documented with: method + path, auth requirement, request body (JSON), response body (JSON), example curl

## Endpoint documentation template

```md
### POST /api/projects

Creates a new project.

**Auth**: `Authorization: Bearer <jwt>` (requires `projects:write` permission)

**Request body**
\`\`\`json
{
  "name": "my-project",
  "description": "optional"
}
\`\`\`

**Response** `201`
\`\`\`json
{
  "id": "abc123",
  "name": "my-project",
  "token": "raw-bearer-token"
}
\`\`\`

**Errors**: `400` invalid body · `403` insufficient permissions · `409` name already exists
```

## CLI command documentation template

```md
### `routerly project add`

Creates a new project interactively or from flags.

\`\`\`bash
routerly project add [--name <name>] [--description <desc>] [--json]
\`\`\`

| Flag | Description |
|------|-------------|
| `--name` | Project name (prompted if omitted) |
| `--json` | Output result as JSON |
```

## Checklist before done

```
[ ] All changed endpoints documented with method, auth, body, response, errors
[ ] All new CLI commands documented with flags and examples
[ ] No documentation refers to removed features
[ ] Code examples are syntactically correct
[ ] Admonitions used for security-sensitive or destructive operations
[ ] Sidebar (website/sidebars.ts) updated if new pages added
```
