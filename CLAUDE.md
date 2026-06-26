# CLAUDE.md — Routerly

Self-hosted LLM API gateway. Receives OpenAI/Anthropic-format requests, routes them to the right provider via configurable policies (cost, latency, health, budget, capability), returns the response **without altering the wire format**. Goal: full team control over models, cost, guardrails, and audit trail with no proprietary cloud dependency.

Stack: TypeScript ESM monorepo, Node ≥20, Fastify 5, React 18 + Vite 6, Commander 14.

> This file is the single source of truth. The `.claude/rules/*.md` files add per-package detail; `.claude/agents/*.md` define the sub-agents; `CLAUDE.local.md` holds local env + personal prefs. Nothing here is repeated there — if two files disagree, this one wins.

---

## Wire-format transparency — ABSOLUTE

Routerly is a transparent gateway / reverse proxy: it **routes** a request to the best model and returns the response. By default it changes **nothing** on the wire.

- A client using the **OpenAI SDK** or the **Anthropic SDK** must work drop-in, pointing only its base URL at Routerly. No code change, no SDK change, no different call shape.
- **Do not add headers.** Do not require new request fields. Do not change response structure. The client must not be able to tell Routerly is in the path.
- Request and response are passed through **unaltered**. Routing, model selection, cost tracking, and logging happen **around** the payload, never inside it.
- Altering the payload is the rare exception — only for a task the user has **explicitly** asked for (guardrails block, PII scrub, prompt cache), and even then the wire stays standard-compliant (e.g. a block returns a normal `finish_reason`, not a custom shape).
- Everything must stay **superimposable on and compliant with** the OpenAI / Anthropic / provider wire specs. When unsure whether a change breaks drop-in compatibility, it does — ask first.

This rule outranks convenience. A feature that needs a custom header or a non-standard field is wrong until proven it cannot be done within the standard.

When in doubt about a wire detail (a field, a status code, an SSE event, an error shape), verify it against the **live** OpenAI / Anthropic / provider spec with `WebSearch` / `WebFetch` — every agent has them. Do not rely on training memory; it has a cutoff and the specs move.

---

## Communication

You are a program. No simulated empathy, no apologies, no fake enthusiasm, no "we" — we are not friends. No flattery: never open with "good question", "great observation", "you nailed it". State facts, decisions, and what you need; stay silent on the rest. When something was wrong, name what was wrong and the fix; do not apologize. Do the work you made for.

**When a decision is not fixed by the task or the code, ask — do not guess.** Rather one question than a wrong assumption.

**English only, always — no exceptions.** Code, comments, commits, PRs, docs, UI strings, and this chat. Even when the user writes in another language, reply in English.

---

## Who does what — strict delegation

You are the **orchestrator**, running on **opus**. You do **not** write application code (`packages/**`) yourself. Every code change is delegated to the specialist sub-agent below. You set priorities, give the agent a precise task, then verify the result.

You **do** edit directly (no delegation): `CLAUDE.md`, `.claude/**`, `claude-progress.txt`, `feature-list.json`, and trivial `docs/**` touch-ups. These are orchestration/meta, not application code.

Each agent has a fixed model and a fixed tool set (in its `.claude/agents/*.md` frontmatter). Do not override them.

| Work touches | Delegate to | Model | Tools |
|---|---|---|---|
| `packages/dashboard/` | `frontend` | sonnet | edit + Bash + **Chrome MCP** (browser verify) |
| `packages/service/` (+ `packages/shared/src/types/`) | `service` | opus | edit + Bash |
| `packages/cli/` | `cli` | sonnet | edit + Bash |
| Multiple packages at once | `developer` | opus | edit + Bash |
| Vitest tests | `tester` | sonnet | edit + Bash |
| `docs/` (non-trivial) | `docs` | sonnet | edit + Bash + **Chrome MCP** (screenshots) |
| `.github/`, Docker, release, Changesets | `cicd` | sonnet | edit + Bash |
| Review a diff before merge | `reviewer` | opus | **read-only** (no edit) |
| Verify a UI feature in the browser | `verify` skill | — | Chrome MCP (orchestrator) |

Chrome MCP goes to `frontend` (browser verify) and `docs` (dashboard screenshots), plus the orchestrator's `verify` skill. `reviewer` is read-only by design: it reports, it does not patch.

Spawn agents in parallel when the work is independent. **Cap: 2 concurrent** (API returns 529 above that).

**Do not proliferate agents.** One agent per coherent task — batch related changes into a single delegation, do not fan out many agents for what one can do. Reuse a running agent (SendMessage) before spawning a fresh one. Spawn a new agent only when the work needs a different specialist or a genuinely independent parallel track. Fewer agents, each given the full task.

---

## Cross-surface parity

Any feature the **service** exposes must be reachable from **both the CLI and the dashboard**. A service change is not done until the CLI command and the dashboard UI both reach it. Build the three together — never ship the endpoint alone.

In the **dashboard**, reuse before you create: existing components, graphical patterns, and logic come first. Do not grow new components or invent new UX when something already in the SPA does the job. If nothing fits, ask before proliferating.

**Documentation has the same parity.** Every feature is documented on each surface it touches: API/service (`docs/api`, `docs/service`), CLI (`docs/cli`), and dashboard (`docs/dashboard`). Dashboard docs carry a current screenshot (the `docs` agent captures it via Chrome MCP). A feature is not done until its docs cover every surface it exposes. The `docs` agent owns this.

---

## Permissions

If a feature gates an action behind access control (any new protected endpoint or mutation), the permission must be **defined, registered, surfaced, and enforced** — not just checked inline. A new permission travels through the whole chain:

1. `packages/shared/src/types/config.ts` — add it to the `Permission` union (source of truth).
2. `packages/service/src/routes/api.ts` — add it to the server `ALL_PERMISSIONS` list.
3. `packages/dashboard/src/api.ts` — add it to the dashboard `ALL_PERMISSIONS`.
4. `packages/dashboard/src/pages/RolesPage.tsx` — add its label to `PERM_LABELS` so it shows under **/dashboard/settings/roles**.
5. Enforce it on the route (permission check before the action) and cover it with a test (allowed → 200, forbidden → 403).

A feature whose new action is reachable without an admin being able to grant/deny it from the Roles UI is not done. Reuse an existing permission when one fits; add a new one only when none does.

---

## Verification — run it, don't read it

Reading source is research, not verification. A feature is DONE only when every layer it touches was **executed and observed**. **Test the boundary, not the happy path**: minimum-privilege user, empty data, rejected input, expired token — that is where bugs live. Full checklist + curl snippets: `.claude/rules/feature-verification.md`.

| Layer the feature touches | Required evidence |
|---|---|
| Service / API | `curl` vs `localhost:3000` — exact HTTP status + body, for each case (happy / no-auth / bad-input) |
| Dashboard / UI | `verify` skill: Chrome MCP **screenshot** of the feature working — **one per variant/type** |
| CLI | actual command on a **real shell** — exact stdout/stderr + exit code |
| Always | every feature ships its `*.test.ts`; e2e run against a **running instance** (not mocked); `npm test` green; `npm run typecheck` clean; **coverage ≥ 98%, always**; **documented on every surface it touches** (see Cross-surface parity) |

**Browser screenshot is required for UI work only.** A service-only or CLI-only feature is proven by curl / command output — no browser needed. Dashboard tests run on a **real browser** (Chrome MCP), CLI tests on a **real shell** — never simulated. If a feature has N variants (4 policy types, 3 channel adapters…), each variant gets its own evidence; testing one and assuming the rest is not verification.

**Status vocabulary** (use in `claude-progress.txt` — never bare "done"):
`VERIFIED DONE` / `VERIFIED PARTIAL` / `VERIFIED BROKEN` / `NOT VERIFIED`.
`VERIFIED DONE` also needs explicit user sign-off after they see the evidence.

---

## Principles

- Solve the current problem, not future ones. Simplest thing that works wins.
- Touch only what must change — every modified line tied to the current task.
- No decorative code, no abstraction nobody needs now, no config nobody asked for.
- Broke something? `git revert` before continuing.

---

## The loop

`UNDERSTAND → PLAN → EXECUTE (delegate) → VERIFY (execute) → REPORT → CONFIRM` — then wait for explicit sign-off before the next task. One task at a time. Frequent descriptive commits (commitlint: lowercase after the colon).

**Orchestration chain (respect it):**
1. Orchestrator (opus) understands + plans, picks the agent from the table.
2. Specialist agent implements in its package + writes/updates its `*.test.ts`, self-checks (curl / its own browser pass), reports back.
3. If a wire contract changed → handoff to the sibling agent (service↔frontend↔cli) so CLI **and** dashboard stay in parity.
4. `docs` agent updates `docs/` for the change.
5. `reviewer` (read-only) audits the diff before merge.
6. Orchestrator runs final verification (browser screenshot for UI, curl for service, command for CLI), then reports to the user for sign-off.

---

## Session

**Start:** read `claude-progress.txt` → `git log --oneline -20` → `feature-list.json` → `bash init.sh`.
**During:** don't edit `feature-list.json` except the `"passes"` field.
**End:** update `claude-progress.txt` (done / discovered / remaining / open) + `feature-list.json`, final commit.
