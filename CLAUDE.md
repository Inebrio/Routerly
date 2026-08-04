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

Still mandatory: `codebase-map` plus the conventions skill for the surface you touch, self-verification with real evidence as in `validation-protocol`, and the documentation for anything a user can see or call. No artifacts, no worktree, no registry.

A batch of small independent fixes is Tier 0 repeated, not Tier 2. Fix them inline, then verify the whole batch once at the end, browser included.

### Tier 1 — one story, agents, no analysis

One deliverable that fails any Tier 0 condition: several surfaces, a contract, a new permission, a data shape, anything a reviewer would want evidence for.

Skip analyst and story-writer. **project-manager** writes the blueprint, then the story runs through `story-lifecycle` in its own worktree: **orchestrator** → engineers → **validator** → **qa-engineer** and **docs-writer**. The worktree is not ceremony: the validator starts the app, and on the main checkout it would collide with your running instance.

### Tier 2 — full chain

More than one deliverable, a new feature, a schema or wire-format or security change, or a request whose scope you cannot state in one sentence. Start at the analyst.

**Uncertain between two tiers → take the higher one.** Over-verifying costs tokens. Under-verifying ships bugs, and the second is the expensive mistake.

Nine agents, artifacts as the only hand-off. Nothing passes through conversation: an agent that needs something reads the file that holds it.

| Artifact | Written by | Path |
|---|---|---|
| Analysis | analyst | `.claude/specs/<feature>/00-analysis.md` |
| Story | story-writer | `.claude/specs/<feature>/01-stories/<story-id>.md` |
| Blueprint | project-manager | `.claude/specs/<feature>/02-blueprint/<story-id>.md` |
| Validation | validator | `.claude/specs/<feature>/03-validation/<story-id>.md` |
| Retrospective | main session | `.claude/specs/<feature>/04-retrospective.md` |

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
9. **docs-writer** documents the change on every surface it ships on, in parallel with the tests. It reads the code, not the blueprint. A story with a user-visible change and no documentation is not done.

**An agent's report is not evidence.** When an agent returns, the main session checks the worktree before believing it: `git status --short` plus the files the blueprint said would exist. Agents have returned confident summaries for files they never wrote, and have returned nothing at all after ninety minutes of work. Both are caught by looking, and only by looking. An agent that returns without a result is resumed with an order to write the deliverable to disk before composing any prose.

### Parallelism

Stories are the unit, not features. Independent stories run at once; the dependency graph decides what is *allowed* to run in parallel, and the machine decides how many of those actually do.

**Concurrency is measured, not chosen. Between one and six, never a fixed number.** Before every dispatch:

```
sh .claude/scripts/capacity.sh
```

It samples for five seconds and prints the slot count, the reason it is that number, how many stories are already in flight, and how many more to dispatch. The exit code is the slot count, so it can gate a loop. Dispatch what it says and not one more. If it says zero more, the answer is to let the running stories finish, never to push the seventh and hope.

The signals it reads, and why each is there:

- **Kernel memory pressure** (`kern.memorystatus_vm_pressure_level`) is the one to trust over the others, because it is what the OS itself acts on. WARN caps at three, CRITICAL at one.
- **Swap growth, not swap used.** Used never falls on macOS: pages stay in swap until something touches them, so a machine that recovered an hour ago still reads eleven gigabytes used and means nothing by it. Growth is the part that means something.
- **Free memory percentage.** Below twenty per cent this laptop starts paging out things the user is actively using, which is the state where it stops being usable for anything else.
- **Load per core**, not raw load. Eight cores make a load of eight ordinary and a load of twenty-four a wall.

Two things the script cannot see, so they are yours to apply on top of it:

- **A container build under QEMU emulation counts for more than one slot.** A `docker buildx --platform linux/amd64,linux/arm64` on this machine froze it hard: buildkit OOM-killed in an eight-gigabyte VM, load average fifty-nine, swap at thirteen gigabytes of fourteen. If a story needs one, it runs alone or it moves to CI.
- **The measurement is a snapshot.** Re-run it between dispatches, not once at the start of a wave.

A slot is held by a story's *implementation*, not by its paperwork. Once a story passes validation, its qa and docs agents keep running while the slot is already claimed by the next story. Holding a slot open for tests and documentation is the single cheapest way to waste hours. Stories touching the same file or the same contract run sequentially, in graph order. The registry (`.claude/registry.json`, main checkout, lock-protected) is what stops two sessions taking the same story or the same ports.

### Integration and closing

Merging is the main session's job, never a teammate's. When a story passes: merge its branch into the integration branch in dependency order, then `story.mjs state <id> done` and `story.mjs release <id>`. `release` refuses a worktree holding unmerged work; merge first, never force past it.

A feature closes when every story is done, the integration branch builds and its tests pass, and the user approves. Specs stay on disk after closing: they are gitignored and they are the record of why the code looks the way it does.

**Human gates: two.** The analyst's questions, and the merge. Everything between runs without asking.

### Retrospective

**Every merged story gets a retrospective entry, written by the main session, appended to `.claude/specs/<feature>/04-retrospective.md` at merge time.** This is a phase of the process, not a courtesy. A feature does not close without it.

The entry answers four questions and nothing else:

1. **Where did the wall-clock actually go?** Real durations, per agent. Not an impression.
2. **What was rework?** An agent that stalled and needed resuming, a blueprint corrected mid-flight, a validator round that a better prompt would have made unnecessary, two agents solving the same problem twice in different places. Name it and say what it cost.
3. **What changes because of it?** A concrete edit: to this file, to an agent definition, to a skill, to a blueprint template. If nothing changes, write "nothing changes" and the reason. A retrospective whose every entry is "went well" is not being written honestly.
4. **What is now known that the next story should not rediscover?** Goes to `.ai/memory.md` if it is about the code, stays here if it is about the process.

The rule that makes it worth anything: **a lesson that does not become an edit is not a lesson.** If three stories in a row report the same waste, the process is what is broken, and fixing it takes priority over the next story.

Report the retrospective to the user in chat when it is written. The user is the one deciding whether the process is worth what it costs, and cannot decide that from a file they were never shown.

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
