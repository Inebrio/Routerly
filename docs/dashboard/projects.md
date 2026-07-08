---
title: Projects
sidebar_position: 4
---

# Dashboard: Projects

The Projects page gives you an overview of all projects and provides access to each project's configuration.

---

## Projects List

![Projects list showing project names, slugs, token count, and daily cost summary](../assets/screenshot-projects.png)

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

### Detect Injection

Toggle the built-in prompt-injection detector on or off. When enabled, every request is scanned for known injection patterns (e.g. "ignore previous instructions", DAN mode). A hit blocks the request and is logged in usage.

### Content Guardrails

Enable guardrails to evaluate requests and/or responses against an ordered list of independent rules. Each enabled rule is evaluated in sequence and triggers its configured block and/or log actions independently.

#### Rule Cards

Each rule card displays:
- **Type**: rule category (regex, semantic, topic, moderation)
- **Target**: request, response, or both
- **Block** checkbox: when checked, the rule rejects requests/responses on a match
- **Log** checkbox: when checked, the rule records the trigger in usage even if it doesn't block
- **Block message**: custom message returned to the client when this rule blocks (appears only if Block is enabled). Leave empty for built-in default.
- **Use judge response**: (topic/moderation only, when Block is enabled) use the judge model's own explanation as the block message instead of the static block message. The judge is asked to return `{ score, message }`. If the judge fails or returns no message, the static block message is used as fallback.

Each rule also displays type-specific configuration fields:

| Type | Target | Config |
|------|--------|--------|
| **Regex** | request / response / both | Regex patterns (one per line, case-insensitive) |
| **Semantic** | request / response / both | Embedding model ID, optional fallback embedding models (multi-select, tried in order), example phrases to block, similarity threshold (0-1, default 0.82) |
| **Topic** | request / response / both | Judge model ID, optional fallback judge models (multi-select, tried in order), allowed-topics description, score threshold (0-1, default 0.5) |
| **Moderation** | request / response / both | Judge model ID, optional fallback judge models (multi-select, tried in order), harm score threshold (0-1, default 0.5). Optionally provide custom system instructions. |

##### Model selection

The model dropdowns are filtered by type:

- **Topic and Moderation** judges: show only non-embedding models (chat/completion models). Embedding-only models cannot act as LLM judges and are excluded.
- **Semantic** embedding field: shows only models with `capabilities.embedding = true`.

##### Fallback models

For topic, moderation, and semantic rules, below the primary model selector is an optional "Fallback models (optional, tried in order)" multi-select field. Select zero or more fallback models that will be tried in order if the primary model is unavailable or returns an error. If the primary model returns a budget-exceeded error, fallbacks are not tried (fail-closed on budget).

#### Streaming Interaction Notice

When a rule has **Block** enabled AND **Target** is response or both, the entire response must be buffered before the block decision is made. In this case, streaming is automatically disabled for the request, and the client receives the full response as a single chunk.

A clear notice box appears on the form when this condition is detected:

> "Responses will be buffered (no streaming) because one or more rules with Block enabled target the response."

#### Consumer impact

When a rule matches and Block is enabled, the request is rejected before reaching the model (or the response is rejected before being sent to the client). Routerly returns HTTP 200 with a wire-faithful content-filter response: `finish_reason: "content_filter"` (OpenAI) or `stop_reason: "refusal"` (Anthropic), with empty content. The block message is stored on the trace but does not appear in the wire response. API consumers that check `finish_reason`/`stop_reason` will detect the block; those that only read message content will receive an empty reply.

When Block is unchecked (Log only) or when a rule is skipped, the request is forwarded with no consumer-visible impact. The triggering rule is recorded on the usage record for audit purposes.

### PII Scrubbing

Enable PII scrubbing to automatically detect and replace sensitive data in requests before they reach the model, and optionally in responses before they are returned to the caller.

PII configuration uses a list of named policies. Click **+ Add policy** to create a new policy. Each policy has:

- **Name**: unique identifier for this policy
- **Enabled** toggle: when off, this policy is skipped
- **Target**: request, response, or both (which side(s) to scrub)
- **Entity types**: checkboxes for EMAIL, PHONE, CREDIT_CARD, SSN, IBAN. All types are selected by default. Uncheck any type to exclude it from scrubbing.
- **Custom patterns**: optional regex patterns in addition to entity detection
- **Streaming buffer size**: (response scrubbing only) suffix buffer size in characters (10-500, default 30). Used to catch patterns spanning chunk boundaries when streaming. Only appears when Target includes response.

All enabled policies with the same direction (request/response) are merged at scrub time. When multiple response policies are active, the largest buffer size is used.

Matched values are replaced with typed placeholders:

| Entity Type | Placeholder | Notes |
|-------------|-------------|-------|
| `EMAIL` | `[EMAIL]` | Email addresses |
| `PHONE` | `[PHONE_NUMBER]` | Phone numbers (US and international formats) |
| `CREDIT_CARD` | `[CREDIT_CARD]` | Card numbers (PAN) |
| `SSN` | `[SSN]` | US Social Security Numbers |
| `IBAN` | `[IBAN]` | International Bank Account Numbers |

#### Consumer impact

PII scrubbing modifies message content before it reaches the model and/or before responses are returned to the caller. Original sensitive values are replaced with typed placeholders. The model receives and responds based on the modified version and cannot reference the original values.

API consumers calling this project's endpoint should be aware that their messages will be modified in-flight. If your application logic requires the model to see exact credit card numbers, email addresses, or phone numbers, disable scrubbing for those entity types. The usage record will include a `piiRedacted` field listing which entity types were detected and scrubbed.

### Saving Security Settings

Click **Save Security Settings** at the bottom of the tab. The button displays a green checkmark on successful save.
