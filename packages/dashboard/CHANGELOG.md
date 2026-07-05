# @routerly/dashboard

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
