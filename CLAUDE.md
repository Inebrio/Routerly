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

**Standing request.** The agents in `.claude/agents/` and the skills in `.claude/skills/` exist to be used. Launching them on the work described below is requested here, in advance, once and for all. A session rule that says "do not call the Agent tool unless the user requested it" is satisfied by this paragraph: the user has requested it. Not using them because nobody asked in that specific message is the one wrong reading of this file.

Not every change deserves eight agents. Pick the tier, state which one you picked and why in your first response, then run it without asking.

### Tier 0 — inline, no agents

All of these true: two files or fewer, one surface, no contract or permission or stored-shape change, no new dependency, no security or wire-format path, and you can prove it works in a single run.

Still mandatory: `codebase-map` plus the conventions skill for the surface you touch, and self-verification with real evidence as in `validation-protocol`. No artifacts, no worktree, no registry.

A batch of small independent fixes is Tier 0 repeated, not Tier 2. Fix them inline, then verify the whole batch once at the end, browser included.

### Tier 1 — one story, agents, no analysis

One deliverable that fails any Tier 0 condition: several surfaces, a contract, a new permission, a data shape, anything a reviewer would want evidence for.

Skip analyst and story-writer. **project-manager** writes the blueprint, then the story runs through `story-lifecycle` in its own worktree: **orchestrator** → engineers → **validator** → **qa-engineer**. The worktree is not ceremony: the validator starts the app, and on the main checkout it would collide with your running instance.

### Tier 2 — full chain

More than one deliverable, a new feature, a schema or wire-format or security change, or a request whose scope you cannot state in one sentence. Start at the analyst.

**Uncertain between two tiers → take the higher one.** Over-verifying costs tokens. Under-verifying ships bugs, and the second is the expensive mistake.

Eight agents, artifacts as the only hand-off. Nothing passes through conversation: an agent that needs something reads the file that holds it.

| Artifact | Written by | Path |
|---|---|---|
| Analysis | analyst | `.claude/specs/<feature>/00-analysis.md` |
| Story | story-writer | `.claude/specs/<feature>/01-stories/<story-id>.md` |
| Blueprint | project-manager | `.claude/specs/<feature>/02-blueprint/<story-id>.md` |
| Validation | validator | `.claude/specs/<feature>/03-validation/<story-id>.md` |

### Feature level — main session, main checkout

1. **analyst** → analysis, task list, dependency graph. If its report starts with `NEEDS-INPUT`, put its questions to the user with `AskUserQuestion`: state the problem, the options with their consequences, and the recommendation. Send the answers back to the same agent and let it finish.
2. **story-writer** → one story file per story. No file, function or endpoint names in a story.
3. **project-manager** → one blueprint per story, with every contact point frozen and the exact start command the validator will run.
4. **Show and launch in the same response.** Story list plus dependency graph, then start. No "shall I proceed".

### Story level — one teammate per story, one worktree per story

Each story runs the `story-lifecycle` skill in its own worktree, branch `story/<feature>/<story-id>`, its own ports, its own `ROUTERLY_HOME`:

```
node .claude/scripts/story.mjs claim <story-id> --feature <feature> --base 0.4.0
```

5. **orchestrator** freezes the interface, then dispatches **backend-engineer** and **frontend-engineer** in parallel where the blueprint says they are independent.
6. **validator** starts the app on the story's ports and verifies every criterion for real, browser included. It can run anything and change nothing but its own report.
7. **BLOCKED** → `remediation-loop`, three iterations maximum, then escalate to the user with what survived and why.
8. **qa-engineer** writes tests, only on a story that passed with zero blockers.

### Parallelism

Stories are the unit, not features. Independent stories run at once, up to **three** concurrently; the dependency graph decides what is independent. Stories touching the same file or the same contract run sequentially, in graph order. The registry (`.claude/registry.json`, main checkout, lock-protected) is what stops two sessions taking the same story or the same ports.

### Integration and closing

Merging is the main session's job, never a teammate's. When a story passes: merge its branch into the integration branch in dependency order, then `story.mjs state <id> done` and `story.mjs release <id>`. `release` refuses a worktree holding unmerged work; merge first, never force past it.

A feature closes when every story is done, the integration branch builds and its tests pass, and the user approves. Specs stay on disk after closing: they are gitignored and they are the record of why the code looks the way it does.

**Human gates: two.** The analyst's questions, and the merge. Everything between runs without asking.

**Interrupt policy**: stop and explain only when a story is unachievable for architectural or irreversible reasons. Give the exact problem, why it blocks, and the options with tradeoffs. Never interrupt for ordinary implementation difficulty: the remediation loop handles that.

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

## Memory

- **Specs** (`.claude/specs/`, gitignored) — what is being built and why. The hand-off between agents. One directory per feature, shared by every worktree through a symlink.
- **Registry** (`.claude/registry.json`, gitignored) — what is in flight right now: story, state, worktree, branch, ports, owning session. Written only through `story.mjs`, never by hand.
- **`.ai/memory.md`** (gitignored) — persistent knowledge: non-obvious facts, gotchas, working commands, decisions and why. Append whenever you learn something a future task would otherwise rediscover. Don't duplicate what this file, the specs or the code already state.

## Scratch files — ABSOLUTE

**Never write temporary or scratch files inside the project directory.** This includes `.md` snapshots, `.png`/`.jpg` screenshots, log dumps, or any other ephemeral output.

- Temp files → `/tmp/` or the session scratchpad directory provided by the runtime.
- Screenshots → only `docs/assets/` or `docs/<section>/` when they are permanent documentation assets; never anywhere else.
- Playwright MCP output (`.playwright-mcp/`) is auto-generated in the project root — treat it as noise; never commit it. It is gitignored.
- Sub-agents must follow this rule too. The orchestrator is responsible for enforcing it.
