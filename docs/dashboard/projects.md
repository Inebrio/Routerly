---
title: Projects
sidebar_position: 4
---

# Dashboard: Projects

The Projects page gives you an overview of all projects and provides access to each project's configuration.

---

## Projects List

The list shows each project's name, slug, number of tokens, assigned models, and a summary of today's cost and call count.

Click any project to open its detail view, which has seven tabs.

---

## General Tab

Shows and lets you edit:

- **Name** — display name for the project
- **Slug** — URL-safe identifier (read-only after creation)
- **Default Timeout** — per-request timeout in milliseconds (overrides the global `defaultTimeoutMs`)
- **Connection Info** — base URL and masked token snippet ready to copy into your SDK configuration
- **Budget** — project-level cost limit (daily / monthly)

---

## Routing Tab

Configure which models this project can use and how to select between them.

### Adding Models

Use the **+ Add Model** button to pick from registered models. Models appear in a numbered list — their order determines the default routing priority (position 0 is highest).

Drag and drop to reorder.

### Adding Policies

Drag policies from the policy panel on the right into the active-policies list on the left. Each policy can be expanded to configure its parameters.

Available policies: `cheapest`, `health`, `performance`, `capability`, `context`, `llm`, `rate-limit`, `fairness`, `budget-remaining`.

See [Concepts: Routing](../concepts/routing.md) for each policy's behaviour and parameters.

---

## Tokens Tab

Manage Bearer tokens for this project.

### Creating a Token

1. Click **+ New Token**
2. Enter a **Name** (e.g. `production`, `staging`, `ci`)
3. Optionally add **Tags** — key-value metadata (e.g., `environment: production`, `team: backend`). Tags are included in every usage record created with this token, enabling filtering and analysis by custom dimensions.
4. Optionally configure per-token limits (metric, limit value, window type, mode)
5. Click **Create**

The token value (`sk-rt-…`) is shown **once**. Copy it immediately.

### Per-Token Limits

Per-token limits let you cap spending for individual applications sharing the same project. The `mode` field controls how the per-token limit interacts with the project-level limit:

| Mode | Behaviour |
|------|-----------|
| `replace` | Per-token limit overrides the project limit for this token |
| `extend` | Both per-token and project limits must pass |
| `disable` | No budget check for this token |

### Rolling or Regenerating a Token

Click the **Re-generate** icon to invalidate the current token and issue a new one. The previous token stops working immediately.

### Editing a Token

Click a token's **Name** to open the edit view. Here you can:

- **Update Tags** — add, remove, or modify key-value metadata. Changes apply immediately to all future usage records created with this token.
- **Modify Limits** — add or remove spending limits without touching the token value itself.

Any changes to tags or limits take effect immediately and do not invalidate the token.

---

## Users Tab

Assign dashboard users to this project. A user assigned here can see and manage the project based on their role's permissions.

Available roles: `viewer`, `editor`, `admin` (or any custom role defined in [Users & Roles](./users-and-roles.md)).

---

## Notifications Tab

Select which notification channels receive events from this project.

**Required permission:** `notification:write` to edit.

### Channel Selection

If **no channels are selected**, all global channels receive events from this project (default behavior).

If **one or more channels are selected**, only those channels receive events from this project. Events are still recorded in the in-app inbox regardless of channel selection.

This provides project-level routing: a single project can funnel its alerts to a dedicated channel (e.g. a project-specific Slack channel or email list) while other projects use the global routing rules.

### Saving Changes

After selecting or deselecting channels, click **Save Changes** to apply. A checkmark appears briefly to confirm the save.

---

## Logs Tab

A live log of recent requests routed through this project.

| Column | Description |
|--------|-------------|
| Timestamp | When the request arrived |
| Model | Provider model that handled the request |
| Status | `success` (green), `blocked` (amber), `error` / `budget_exceeded` etc. (red) |
| Input Tokens | Number of input tokens |
| Output Tokens | Number of output tokens generated |
| Cost | Estimated USD cost |

A `blocked` status means a guardrail rule rejected the request before it reached any model. Zero tokens and zero cost are recorded.

Click any row to open the **Trace view** which shows the full routing decision: which policies ran, which models were considered, and why the final model was chosen.

The table auto-refreshes at a configurable interval. Use the interval selector (5 s / 15 s / 30 s / 1 min / 5 min / Off) to control polling.

---

## End Users Tab

Shows per-end-user activity attributed to this project via the `body.user` field in LLM requests.

**Required permission:** `report:read`

| Column | Description |
|--------|-------------|
| User ID | End-user identifier (from `body.user` in the request) |
| Requests | Total number of requests attributed to this user |
| Tokens | Total tokens used by this user (input + output) |
| Cost | Estimated USD cost for this user's requests |
| First Seen | Timestamp of this user's first request through the project |
| Last Seen | Timestamp of this user's most recent request |

The table is empty when no requests have been made with a `body.user` value.

---

## Security Tab

Configure request filtering and data protection for this project.

**Required permission:** `project:update`

### Content Guardrails

Enable guardrails to evaluate requests and/or responses against an ordered list of security policies. All security policies run in parallel — multiple policies can be active simultaneously and all execute on every request.

When enabled, configure:

- **Action** — what to do when a policy triggers:
  - `Block`: reject before forwarding to the model; return a wire-faithful HTTP 200 with `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic)
  - `Flag`: forward but tag the usage record as `guardrailTriggered` for audit
  - `Log`: forward silently, write to service logs only
- **Fallback message** (Block only) — error message returned to the client
- **Security policies** — list of policy cards; click **+ Add policy** to add one

Each security policy has a **type** and **target** (request / response / both):

| Type | Target | Config |
|------|--------|--------|
| **Regex** | request / response / both | One regex pattern per line (case-insensitive) |
| **Injection** | request only | No config — uses built-in patterns (jailbreak, DAN, "ignore previous instructions") |
| **Semantic** | request / response / both | Embedding model ID, example phrases to block, similarity threshold (0-1, default 0.82) |
| **Topic** | request / response / both | Judge model ID, allowed-topics description, score threshold (0-1, default 0.5) |
| **Moderation** | request / response / both | Judge model ID, harm score threshold (0-1, default 0.5) |

##### Moderation policy instructions

You can provide custom instructions that are prepended to the moderation prompt. The JSON response format instruction is always appended automatically and cannot be overridden. This ensures the moderation system always returns structured scores for consistent evaluation.

##### Model selection

The model dropdowns are filtered by type:

- **Topic and Moderation** judges — show only non-embedding models (chat/completion models). Embedding-only models cannot act as LLM judges and are excluded.
- **Semantic** embedding field — shows only models with `capabilities.embedding = true`.

This prevents misconfiguration: a topic or moderation rule configured with an embedding model would fail silently at evaluation time.

#### Consumer impact

When a policy matches and action is `Block`, the request is rejected before reaching the model. Routerly returns **HTTP 200** with a wire-faithful content-filter response — `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic) — with empty content. The fallback message is stored on the trace but does not appear in the wire response. API consumers that check `finish_reason`/`stop_reason` will detect the block; those that only read message content will receive an empty reply.

When action is `Flag` or `Log`, the request is forwarded with no consumer-visible impact. The triggering policy type is recorded on the usage record.

### PII Scrubbing

Enable PII scrubbing to automatically detect and replace sensitive data before requests reach the model, and optionally in the model's response before it is returned to the caller.

When enabled, configure:

- **Scrub input** (default on) — scrub user message content before forwarding to the provider.
- **Scrub output** (default off) — scrub the provider's response content before returning it to the caller. Enable this when the model may echo or repeat sensitive values in its reply.

Select which entity types to scrub:

| Entity Type | Placeholder | Notes |
|-------------|-------------|-------|
| `Email` | `[EMAIL]` | Email addresses |
| `Phone` | `[PHONE_NUMBER]` | Phone numbers (US and international formats) |
| `Credit Card` | `[CREDIT_CARD]` | Card numbers (PAN) |
| `SSN` | `[SSN]` | US Social Security Numbers |
| `IBAN` | `[IBAN]` | International Bank Account Numbers |

All types are selected by default. Uncheck any type to exclude it from scrubbing. Matched values are replaced with their typed placeholders and never stored or forwarded to the model.

#### Consumer impact

PII scrubbing modifies message content before it reaches the model. Original sensitive values are replaced with typed placeholders. The model receives and responds based on the modified version and cannot reference the original values.

API consumers calling this project's endpoint should be aware that their messages will be modified in-flight. If your application logic requires the model to see exact credit card numbers, email addresses, or phone numbers, disable scrubbing for those entity types. The usage record will include a `piiRedacted` field listing which entity types were detected and scrubbed.

### Saving Security Settings

Click **Save Security Settings** at the bottom of the tab. The button displays a green checkmark on successful save.
