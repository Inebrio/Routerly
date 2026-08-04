# @routerly/cli

## 0.5.0

### Minor Changes

- 52b0640: Optimizer overhaul.

  Removed: the in-memory traffic-sample buffer, the
  `GET /api/projects/:id/optimizers/samples` route, and `routerly optimizers
samples`. Real prompts were buffered per project and served to any holder of
  `optimizers:read`. Synthetic fixtures replace them as preview material:
  `support-chat-en`, `agent-tools-en`, `brief-en` and `long-context-en`, listed
  by `routerly optimizers fixtures` and offered by the dashboard preview box.

  Fixed: `headroom` never fired. It read the context window off the routing
  attempt, which does not exist yet when the step runs, so it declared itself
  unsupported on every request since it shipped. It now resolves the window from
  the model named in the request, cached for 30 seconds. Routing may pick a
  different model than the one requested, so the trim can be more generous than
  needed, never more aggressive; an unknown model leaves the step inert.

  Added: `json-table`, an eighth optimizer that rewrites long uniform JSON arrays
  as a header row plus value rows.

  Changed: `ccr` keeps 3 recent turns by default instead of 6; `relevance`
  defaults to an overlap of 0.1 instead of staying inert.

  Fixed: `caveman` no longer destroys unquoted file paths, dotted identifiers or
  bare JSON payloads, and it no longer strips non-English text with an English
  word list. It is the rule-based English step and now stays inert elsewhere.

  Fixed: `llmlingua-2` produced meaningless output. It fed the ONNX session
  pseudo-random ids from a local hash instead of the checkpoint's vocabulary, and
  split text on whitespace instead of tokenizing it. It now loads the model
  through `@huggingface/transformers`, which replaces the `onnxruntime-node`
  optional dependency, and compresses any language the multilingual encoder
  covers. It also threw on any message past the encoder's 512-token window and
  was rolled back silently, so it did nothing on exactly the long prompts it
  exists to compress; tokens are now scored one window at a time.

  Added: three installable `llmlingua-2` checkpoints instead of one unreachable
  default, from 182 MB at 8-bit to 713 MB at full precision, downloaded on the
  service host and shared by every project. Which one a project runs on is a
  property of its step: `--checkpoint` on the CLI, a picker in the dashboard
  row, `model` on the step in the API. `ROUTERLY_LLMLINGUA_MODEL` and
  `ROUTERLY_LLMLINGUA_DTYPE` still publish a custom one and make it the default.

  Added: `GET` and `POST /api/optimizers/llmlingua2/model`, `routerly optimizers
model [--install [key]]`, and the same download inside the dashboard's
  llmlingua-2 row, with a progress bar that survives a page refresh and a
  checkbox that stays disabled until a checkpoint is ready. The checkpoint had
  no installation path at all before this.

  Added: a `model` on `POST /api/optimizers/preview` and `routerly optimizers
preview --model`, so context-window steps have a window to size against in a
  dry run.

  Added: every step reports why it did nothing, in the trace, the preview API,
  the dashboard and the CLI.

  Fixed: saving a pipeline that included `json-table` was rejected with
  "Invalid optimizers config", because the API's step-id enum had not been
  extended with the new id.

### Patch Changes

- Updated dependencies [52b0640]
- Updated dependencies [d8e4eb0]
  - @routerly/service@0.5.0
  - @routerly/shared@0.5.0

## 0.3.0

### Minor Changes

- c81dfe1: ## Routerly 0.3.0

  ### New features

  **Content guardrails and PII scrubbing**
  Requests can be filtered through configurable guardrail rules before reaching an upstream provider. Rules support keyword matching, regex patterns, and an LLM-based classifier. Matched requests are blocked with a standard provider-compliant response shape. PII scrubbing runs as a pre-send middleware and redacts configurable entity types (email, phone, credit card, SSN, IP address). Guardrail model calls are counted under the originating project with call type `guardrail` and are visible in `/api/usage`, the dashboard usage view, and the CLI `report usage` command.

  **Notification system rework: dashboard channel, per-event routing, and per-user targeting**
  A new `dashboard` notification channel delivers alerts to the in-app inbox without requiring credentials. All channels (email, Slack, Teams, PagerDuty, Discord, dashboard) now accept an `events` list to limit which event types they handle, and a `targets` list to restrict delivery to specific roles, permissions, or individual users. The in-app inbox is now per-user filtered based on these targets. Email channels resolve recipient addresses dynamically from target definitions. Existing configurations without `events` or `targets` fields continue to work unchanged.

  **Notification UX: bell and inbox moved to profile**
  The notification bell has been removed from the sidebar. The unread count is now shown on the profile row. The full notification inbox is accessible at `/dashboard/profile/notifications`.

  **Dashboard information architecture**
  The Leaderboard page has been consolidated into the Usage page as a tab. Provider Health has been consolidated into the Models page as a tab. The Models page gains a provider filter and pagination. The former `/dashboard/leaderboard` and `/dashboard/health` routes redirect to their new locations.

  **Enterprise providers**
  Added adapters for AWS Bedrock, Azure OpenAI, and Google Vertex AI.

  **Native notification adapters**
  Built-in adapters for Slack, Microsoft Teams, PagerDuty, and Discord.

  **Prompt playground**
  Interactive prompt editor in the dashboard with compare mode and presets. Requests are sent directly through the gateway so results reflect real routing, model selection, and cost tracking.

  **Model discovery**
  A `/api/catalog` endpoint exposes the full model catalog. The dashboard includes a discovery page with provider filter. The CLI gains a `model discover` command. Free and local models are labeled correctly; unknown models fall back gracefully instead of returning 404.

  **2FA / TOTP**
  TOTP-based two-factor authentication for user accounts. Enrollment and login verification flow in the dashboard.

  **Permissions audit**
  Expanded permission set with fine-grained access control. All permissions are registered in the shared `Permission` union, surfaced in the Roles UI, and enforced on protected routes.

  **Update channel management**
  Automated update workflow with configurable update channels.

  ### CLI improvements
  - `routerly notification channel` supports the `dashboard` channel type, `--events` flag to restrict event types, and `--targets` flag to set delivery targets (roles, permissions, users)
  - `report usage` breakdown now includes guardrail call count and cost
  - Fixed a bug where DELETE requests were sent with a body, causing rejections on strict servers
  - Fixed `model discover` incorrectly labeling free and local models; unknown model IDs no longer produce a 404

  ### Bug fixes and maintenance
  - Fixed notification dropdown z-index in the dashboard
  - Fixed 2FA UX edge cases during enrollment
  - Reverted experimental prompt registry (feature branch merged in error)

  ### Breaking changes

  None. The OpenAI and Anthropic wire formats are unchanged. Notification channel configs without `events` or `targets` continue to work.

### Patch Changes

- Updated dependencies [c81dfe1]
  - @routerly/shared@0.3.0

## 0.1.1

### Patch Changes

- Fix CI pipeline: correct build order, TypeScript strict-mode errors, and release workflow for private monorepo
- Updated dependencies
  - @routerly/shared@0.1.1

## 0.1.0

### Minor Changes

- b8381ec: Initial release

### Patch Changes

- Updated dependencies [b8381ec]
  - @routerly/shared@0.1.0
