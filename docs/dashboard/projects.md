# Projects

The **Projects** page is where you create and manage isolated project workspaces. Each project has its own API token, model list, routing policies, and budget configuration.

---

## Project List

Navigate to **Projects** in the sidebar. Each row shows:

- Project name and slug
- Routing model
- Number of associated models
- Number of members

Click on a project name to open its detail view.

---

## Creating a Project

Click **New Project** to open the creation form.

| Field | Description |
|-------|-------------|
| **Name** | Human-readable project name |
| **Slug** | URL-safe identifier (alphanumeric + dashes). Used in the per-project endpoint: `/projects/:slug/v1/` |
| **Description** | Optional free-text description |
| **Routing model** | The LLM used to analyze requests and score candidate models. A small, fast model (e.g. `gpt-4o-mini`) is recommended |
| **Models** | Initial set of models to associate with this project |

After creation, the **project API token** is displayed once. Copy it, it cannot be retrieved later.

---

## Project Detail Tabs

Clicking on a project opens a tabbed detail view:

### General

Displays the project's basic information (name, slug, description, token preview) and allows editing them.

### Routing

Configure the routing policies applied to requests in this project.

Policies are shown in an ordered list, the order determines their weight (first = highest weight). You can:
- Enable or disable individual policies with a toggle
- Drag to reorder policies (changes their scoring weight)

Available policies:

| Policy | What it does |
|--------|-------------|
| `capability` | Matches request requirements to model capabilities |
| `budget-remaining` | Prefers models with more budget headroom |
| `cheapest` | Prefers the lowest-cost model |
| `health` | Penalizes recently failing models |
| `performance` | Prefers lower-latency models |
| `context` | Analyzes request content to choose the most suitable model |
| `llm` | Delegates routing decision to a secondary LLM |
| `rate-limit` | Penalizes models close to rate limit |
| `fairness` | Distributes load evenly across models |

See [Routing Engine](../service/routing.md) for detailed policy descriptions.

### Tokens

Manage API tokens for this project. Multiple tokens can be created for finer-grained access
control or to meter individual consumers.

- **Create token**, generates a new unique API token
- **Edit token**, add per-model limits for a specific token
- **Delete token**, immediately revokes access for that token

Each token can have its own `limits` per model (overriding project/global limits):

| Mode | Behavior |
|------|---------|
| `replace` | Token limits override project limits |
| `extend` | Token limits stack on top of project limits (both must pass) |
| `disable` | All limits disabled for this token |

### Users

Manage which dashboard users have access to this project and with what role:

| Role | Permissions |
|------|------------|
| `viewer` | Read-only access to project data |
| `editor` | Can modify routing config and models |
| `admin` | Full access including token and member management |

### Logs

Displays recent request traces for this project. Each row shows:

- Timestamp
- Model selected
- Input / output tokens
- Cost
- Latency
- Routing trace (expandable)

Click on any row to expand the full routing trace, showing which policies ran, what scores were assigned, and why a model was chosen.

---

## Deleting a Project

Open the project and click **Delete Project** in the General tab. This:
- Removes the project and all its tokens immediately
- Does **not** delete associated models (they remain globally registered)
- Does **not** delete historical usage records

---

## See Also

- [CLI: project commands](../cli/commands.md#project): create and manage projects from the terminal
- [Budgets & Limits](../service/budgets-and-limits.md): full limit configuration reference
- [Routing Engine](../service/routing.md): how routing policies are scored
