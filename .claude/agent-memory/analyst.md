# Analyst memory

## 0.4.1 package (Router rename + Orchestrator + Passthrough + i18n + #124 + perms + coverage + docs)

- `project` (case-insensitive) appears in **5,939 places across 307 files**, all four packages
  (raw `grep -ri project` count, 2026-08-06). Any future analysis of a `project`→`router` rename
  does not need to re-run this count; it will not have shrunk unless the rename already shipped.
  Primary type site: `packages/shared/src/types/config.ts:231,485,500,535`
  (`ProjectModelRef`/`ProjectMember`/`ProjectToken`/`ProjectConfig`). Storage key: `projects` in
  `packages/service/src/lib/paths.ts:12` and `StoredTypeMap`/`DEFAULTS` in
  `packages/service/src/modules/config/loader.ts:40,62`. REST surface: ~40 endpoints under
  `/api/projects*` in `packages/service/src/modules/api/api.ts`. CLI: `packages/cli/src/commands/
  project.ts` (290 matches), registered as `makeProjectCommand()` in `packages/cli/src/index.ts:43`.
  Dashboard: 14 files under `packages/dashboard/src/pages/project/` + `ProjectsPage.tsx`, routes
  `projects`/`projects/new`/`projects/:id*` in `App.tsx:408-431`, nav label at `App.tsx:122`.

- Routing candidates are **model-only by construction today**, not by convention:
  `RoutingCandidate.model` (`packages/shared/src/types/routing.ts:3-9`) is a bare model-id string,
  `CandidateModel` (`policies/types.ts`) wraps only a `ModelConfig`, and `scoreCandidates`/
  `routeRequest` (`packages/service/src/modules/routing/router.ts`) resolve every candidate against
  `listEffectiveModels()`. The per-candidate execution loop that turns a winning candidate into an
  actual call lives in exactly two files: `packages/service/src/modules/reverse-proxy/
  lanes/anthropic.ts:181` and `lanes/openai.ts:228` (`for (const candidate of sorted)`), both
  calling into `execute.ts`'s `llmChat`/`llmMessages`, which resolve a provider adapter per
  `ModelConfig`. Any feature needing a non-model candidate (e.g. Orchestrator→Router routing) must
  touch all three files plus the shared type — there is no existing seam for "this candidate is not
  a model."

- The 0.3.0 "transparent proxy" (`packages/service/src/modules/api-reverse-proxy/passthrough.ts`)
  already implements the exact Anthropic-vs-everything-else header asymmetry
  (`x-api-key` vs `Authorization: Bearer`, `buildUpstreamHeaders`, lines 77-96) that any new
  wire-format-based destination inference needs — read this file first before designing a new
  passthrough-style route, it is prior art already tested in this codebase, not something to derive
  from a provider spec. Its `pickUpstreamModel` **requires** `project.models` to resolve — that
  requirement is precisely what a "pure passthrough, no model registration" variant must NOT
  inherit, so it needs a new code path, not a flag on this one.

- No i18n library exists in `packages/dashboard` (checked `package.json` deps + grepped
  `i18n|locale|translations`: zero framework hits). Any dashboard i18n work starts from zero, not
  from an existing partial integration.

- No file-permission-check code exists anywhere in `packages/service`/`packages/cli` (grepped
  `chmod|0o600|0o700`: only the secret-file write at `loader.ts:226-240`
  `getOrCreateSecret()`, and unrelated MCP file-read code). A "check config dir permissions,
  block/warn, ask before fixing" feature is greenfield, not an extension of an existing check.

- `docs/concepts/architecture.md` (as of 2026-08-06) still describes the **pre-0.4.0** architecture
  (three-box diagram: Auth Guard / Router / Budget Guard → Provider Adapters) — no mention of the
  kernel/`ServiceContainer`/`EventBus`/`ProcessorRegistry`/module-manifest system that
  `packages/service/src/core/sdk.ts` documents as the real 0.4.0 shape. Confirms the doc-vs-code gap
  is real, not assumed, without needing to open every doc page — this one page alone proves it.

- Per-package vitest coverage thresholds (re-read directly from each package's
  `vitest.config.ts`, 2026-08-06, matches the number the KB already had): shared
  83.4/80.0/78.1/83.9, service 97.5/91.2/95.7/96.3, cli 98.6/95.3/99.1/98.4, dashboard
  98/98/98/98 (lines/branches/functions/statements). These are floors with a "raise with evidence,
  never lower" convention (visible in the file's shape, not stated as a comment) — not a flat 98%
  target. `coverage/coverage-final.json` at repo root was stale (predates this session) and should
  not be trusted without a fresh `vitest run --coverage`.

- `docs-versions` branch is only pushed by `main`'s release job when
  `needs.release.outputs.channel == 'current'` (`.github/workflows/release.yml:152,175-221`). A
  documentation pass merged anywhere else (develop, a feature branch) never cuts a doc version by
  itself — it only reaches the always-live `next` docs until an eventual `main` promotion.

- Guard rail learned the hard way: this agent's `Write` tool is blocked outside
  `.claude/specs/`, `.claude/agent-memory/`, `.claude/agent-memory-local/`, and temp dirs
  (`.claude/scripts/guard-write.mjs`, mode `artifacts`). `.ai/memory.md` (the project-wide
  persistent-knowledge file) is NOT writable by this role despite the analyst prompt's own "Memory"
  section describing cross-session memory in general terms — cross-session analyst memory belongs
  in `.claude/agent-memory/analyst.md` (this file), not `.ai/memory.md`. Do not retry writing to
  `.ai/memory.md`; report the finding to the main session instead if it belongs there.
