# Routerly Delivery Workflow

The repeatable loop every task runs through, and the role each agent plays in it. The **project-manager is the main orchestrator thread** (opus) — it has no agent file; it plans, delegates, verifies, and is the only one that spawns sub-agents (sub-agents cannot spawn sub-agents). Everyone else is a sub-agent with a fixed model, a fixed tool set, and one job.

Concurrency cap: **2 sub-agents at once** (the API 529s above that). Reuse a running agent (SendMessage) before spawning a fresh one. One agent per coherent task — do not fan out.

---

## Roles

| Role | Agent file | Model | Tools | Owns | Edits code? |
|------|-----------|-------|-------|------|-------------|
| **Project Manager** | *(main thread)* | opus | all (orchestration) | plan, delegate, final verify, sign-off, `handoff.md` + `feature-list.json` | no — meta only (`CLAUDE.md`, `.claude/**`, progress, docs touch-ups) |
| **Backend Developer** | `backend-developer` | opus | edit + Bash | `packages/service`, `packages/cli`, `packages/shared/src/types`, CI/Docker/release | yes (backend + tooling) |
| **Frontend Developer** | `frontend-developer` | sonnet | edit + Bash + Chrome MCP | `packages/dashboard` | yes (UI) |
| **QA Manager** | `qa-manager` | sonnet | edit + Bash + Chrome MCP | `*.test.ts` suite, full verification matrix, coverage ≥98% | tests only |
| **UI Design Reviewer** | `ui-design-reviewer` | sonnet | read + Bash + Chrome MCP (read) | dashboard visual/UX quality | no (read-only) |
| **Pattern Reviewer** | `pattern-reviewer` | opus | read + Bash | security, constraints, correctness, reuse, docs parity | no (read-only) |
| **Docs** | `docs` | sonnet | edit + Bash + Chrome MCP | `docs/` on every surface + screenshots | docs only |

---

## The loop

Reiterable. Every task — feature, fix, refactor — runs the full loop. A failure at any review/verify stage loops back to **Implement** with the findings; it does not skip ahead.

```
0 PLAN ─► 1 IMPLEMENT ─► 2 PARITY ─► 3 VERIFY ─► 4 DESIGN ─► 5 DOCS ─► 6 REVIEW ─► 7 SIGN-OFF
  (PM)      (devs)        (devs)      (QA)        (UI rev)    (docs)    (pattern)    (PM ─► user)
                ▲                                                           │
                └────────────────── findings loop back ─────────────────────┘
```

### 0 — PLAN  *(project-manager / main thread)*
Read `handoff.md`, `git log --oneline -20`, `feature-list.json`. For any non-trivial change, **run `/graphify`** to map the affected code before planning — do not guess the structure from memory (this is the orchestrator's step; sub-agents have no Skill tool). State the task in one line. Decide **which surfaces it touches** (service / CLI / dashboard / docs) and the acceptance criteria + boundary cases to prove. Pick the agent(s) from the table. Output: a concrete task brief per agent.

### 1 — IMPLEMENT  *(backend-developer and/or frontend-developer)*
Delegate the code. Backend and frontend run **in parallel** when the work is independent (cap 2). Each developer writes its code, self-checks (`typecheck`, its own curl / browser pass), and reports.

### 2 — PARITY  *(developers)*
A service feature must reach **both** the CLI and the dashboard. `backend-developer` ships service + CLI and hands the endpoint contract to `frontend-developer` for the UI. The endpoint alone is not done.

### 3 — VERIFY  *(qa-manager)*
Writes/extends `*.test.ts`, runs the matrix: `npm test` green, `npm run typecheck` clean, **coverage ≥98%**, service curl boundary cases (happy / 401 / 400 / 403), low-privilege permission test, CLI command output, browser UAT per variant. Returns a VERIFIED status with evidence. **PARTIAL/BROKEN → back to step 1.**

### 4 — DESIGN  *(ui-design-reviewer — only if the dashboard changed)*
Opens the real UI, reviews theme (dark+light), consistency, reuse, layout, states, accessibility. Severity-tagged findings. **BLOCKING/MAJOR → back to step 1.** Skip for service-only / CLI-only changes.

### 5 — DOCS  *(docs)*
Updates `docs/` on **every surface the feature touches** (API/service + CLI + dashboard). Dashboard docs get a current screenshot via Chrome MCP. No stale images, no docs for removed features.

### 6 — REVIEW  *(pattern-reviewer)*
Read-only pre-merge audit: security → constraints → correctness → conventions → reuse/over-engineering → coverage → docs parity. Severity-tagged. **BLOCKING/MAJOR → back to step 1.**

### 7 — SIGN-OFF  *(project-manager / main thread)*
Run final independent verification (browser screenshot for UI, curl for service, command for CLI). Present the evidence. Update `handoff.md` (done / discovered / remaining / open) and `feature-list.json` (`passes` field only). Commit (conventional, lowercase after the colon). **`VERIFIED DONE` requires explicit user sign-off after they see the evidence.** Then wait for the next task.

---

## Handoff contracts

| From | Event | To |
|------|-------|----|
| backend-developer | new shared type / endpoint the UI must reach | frontend-developer (with contract: method, path, body, response, permission) |
| backend-developer | new/changed endpoint, policy, provider, config schema, CLI command | docs |
| frontend-developer | new/changed page or setting | docs |
| any developer | implementation reported | qa-manager |
| frontend-developer | UI functionally working | ui-design-reviewer |
| qa-manager | VERIFIED (green) | pattern-reviewer |
| qa-manager / ui-design-reviewer / pattern-reviewer | findings (PARTIAL/BROKEN/BLOCKING/MAJOR) | back to the owning developer (step 1) |

---

## Rules that bind every step

- **Wire-format transparency is absolute** (CLAUDE.md). Request + response pass through unaltered; OpenAI/Anthropic SDK stays drop-in. Payload changes only for an explicitly-requested, still standard-compliant task.
- **Verification is executed, never read.** A layer is done only when it was run and observed. Status vocabulary: `VERIFIED DONE` / `VERIFIED PARTIAL` / `VERIFIED BROKEN` / `NOT VERIFIED` — never a bare "done". Full protocol: `.claude/rules/feature-verification.md`.
- **Permissions travel the full chain** (CLAUDE.md § Permissions) and must be grantable from /dashboard/settings/roles.
- **Reuse before you create**, in code and in UI. Touch only what the task needs.
- **Update `handoff.md` after every phase.** Each phase (0–7) appends one block to `handoff.md` at the repo root — `## <phase> — <status>`, a one-line summary, and the next step — so the file is always the live state of the run. A new task starts a fresh `handoff.md` (overwrite the header); phases within it append. `/feature` does this automatically per step; the manual loop does it by hand.
- One task at a time. Frequent descriptive commits. English only, everywhere.
