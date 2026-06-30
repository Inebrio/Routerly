# Routerly

Self-hosted LLM API gateway. Routes OpenAI/Anthropic requests to the best provider; returns responses unaltered.

Stack: TypeScript ESM monorepo, Node ≥20, Fastify 5, React 18 + Vite 6, Commander 14.

---

## Wire-format transparency — ABSOLUTE

Routerly is a router. Its only job is to forward requests to the best provider and return the response unaltered.

- **No custom headers** — never add, remove, or rename headers on request or response.
- **No non-standard fields** — request and response payloads must be identical to what the SDK sent / what the provider returned.
- **Drop-in compatibility** — any client using the official OpenAI or Anthropic SDK must work by changing only the base URL to Routerly. No client-side changes allowed.
- **Provider-agnostic** — this rule applies to every provider we implement now or in the future.
- **Payload changes only** for explicitly requested features (guardrails, PII scrub, cache) — and only the minimum necessary, verified against live provider specs.
- Never rely on training memory for wire format details — check against live specs.

---

## Workflow

**Classify first (orchestrator decides, no asking):**
- No code change needed (question, explanation, reading) → respond directly
- Any code change required → complex, launch workflow
- Uncertain → treat as complex

**Simple** → respond directly, self-verify on each touched surface, report "ready to test".

**Complex** → deterministic workflow scripts, no permission seeking between steps:

**Before launching Phase 1 — orchestrator pre-flight (mandatory):**

1. **Analyze**: read the relevant existing files (routes, components, similar pages). Understand current patterns, component usage, naming conventions.
2. **Clarify**: if there are genuine doubts about behavior, placement, or scope — ask the user. One round, all questions together. Do NOT ask if the answer can be inferred from the codebase.
3. **Task list**: decompose the work into numbered atomic micro-tasks (each independently testable). Example:
   ```
   1. Add GET /api/notifications/channels/:id route + test
   2. Add PATCH /api/notifications/channels/:id route + test
   3. Add dashboard NotificationChannelDetailPage + route
   4. Add CLI `routerly notifications channels show <id>` command
   ```
4. **Communicate + launch immediately**: show the task list and launch the workflow in the same response — no pause, no confirmation request, no "shall I proceed?". Showing the plan IS the notification; execution follows without waiting.
5. **Build goal**: detailed `goal` string — not "add X" but "add X to file Y using component Z, matching pattern in W, exact behavior: [description]"
6. **Launch**:
   ```
   Workflow({scriptPath: '.claude/workflows/dev-loop.js', args: {goal, worktreeSlug, tasks}})
   ```
   `tasks` = array of `{id, description}` objects from step 3.

**Phase 1** (task-driven loop):
- Processes tasks one by one: analysis → developer → checker → smoker per task
- Task list lives in `.ai/state.md`, updated at every step
- Orchestrator may modify the task list between tasks if new information warrants it
- Returns when ALL tasks pass smoke, or BLOCKED if a task is unachievable

**Interrupt policy**: orchestrator stops and explains to the user ONLY when a task is unachievable for reasons of major architectural impact or irreversible risk. Must detail: exact problem, why it blocks, all possible solutions with tradeoffs. Map the block in state.md. Never interrupt for normal implementation difficulty — the loop handles it.

Orchestrator presents all-tasks-done evidence to user. **Waits for human approval.**

**Phase 2** (after approval):
```
Workflow({scriptPath: '.claude/workflows/qa-loop.js', args: {goal, worktreeSlug, startingBranch, tasks}})
```
Runs: tester (full suite + coverage ≥98% + browser UAT) → docs → reviewer. Returns merge instructions.

Orchestrator waits for **final user approval**, then executes merge + worktree cleanup.

**Every step**: read `.ai/state.md` at start, update it at end.

---

## Surface parity

Service change = CLI change + dashboard change. Always. All three surfaces ship together.
Exception (rare, must be justified explicitly): a surface truly has no entry point for the feature.

---

## Permissions

New permission → `shared/types/config.ts` → `service/routes/api.ts` → `dashboard/api.ts` → `dashboard/pages/RolesPage.tsx` → enforce on route + test it.

---

## Code principles

- Solve the current problem only. Simplest correct diff.
- Touch only what the task requires. No speculative abstraction.

## Quality bar

Visual quality and usability are equal requirements to functional correctness. A feature that works but looks broken or is hard to use is not done.

**Dashboard**: spacing and alignment consistent with existing pages, correct dark/light theme, empty states handled, loading/error states present, no layout breaks.

**CLI**: output format consistent with existing commands, meaningful error messages to stderr, `--json` output always parseable, exit codes correct, `--help` accurate.

---

## Communication

No empathy, apologies, enthusiasm. State facts. Ask rather than guess.

Artifacts English. Chat follows user language.

---

## Session memory

`.ai/state.md` (gitignored) — current task, components touched, phase, next steps. Updated at every phase transition.
