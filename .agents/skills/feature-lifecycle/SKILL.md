---
name: feature-lifecycle
description: Run a Tier 1 or Tier 2 feature end to end — feature level, story level, parallelism, integration, and retrospective. Use when you are running a multi-agent feature per AGENTS.md's Workflow tiers, not for Tier 0 inline work.
---

# Feature lifecycle

The mechanics for running a Tier 1 or Tier 2 feature, once the tier is picked
per `AGENTS.md`'s Workflow section. See `story-lifecycle` for what a single
story does inside its own worktree; this skill covers the layer above it —
feature level, parallelism across stories, integration, and the retrospective.

## Feature level — main session, main checkout

1. **analyst** → analysis, task list, dependency graph. If its report starts with `NEEDS-INPUT`, put its questions to the user with `AskUserQuestion`: state the problem, the options with their consequences, and the recommendation. Send the answers back to the same agent and let it finish.
2. **story-writer** → one story file per story. No file, function or endpoint names in a story.
3. **project-manager** → one blueprint per story, with every contact point frozen and the exact start command the validator will run. **At most six engineer tasks per story.** Every task is a fresh agent that reads the repository, the blueprint and the conventions from nothing, so a seventh task costs more in re-read context than the split saves in focus. Measured: one story split into twelve tasks spent 57M input tokens on its engineers alone, 15% of an eighteen-story feature. If a story genuinely needs more than six, it is more than one story and belongs back with the story-writer.
4. **Show and launch in the same response.** Story list plus dependency graph, then start. No "shall I proceed".

## Story level — one teammate per story, one worktree per story

Each story runs the `story-lifecycle` skill in its own worktree, branch `story/<feature>/<story-id>`, its own ports, its own `ROUTERLY_HOME`:

```
node .Codex/scripts/story.mjs claim <story-id> --feature <feature> --base 0.4.0
```

5. **orchestrator** freezes the interface, then dispatches **backend-engineer** and **frontend-engineer** in parallel where the blueprint says they are independent.
6. **validator** starts the app on the story's ports and verifies every criterion for real, browser included. It can run anything and change nothing but its own report.
7. **BLOCKED** → `remediation-loop`, three iterations maximum, then escalate to the user with what survived and why.
8. A story that passes validation with zero blocking findings merges into its base branch right away: `story.mjs state <id> done` and `story.mjs release <id>`. **qa-engineer** and **docs-writer** do not run per story — every story merges as fast as validation clears it, and formalization happens once, at the feature-level user-check gate below, after every story is in.

**An agent returns a summary and a path, never the report itself.** Its
deliverable is already on disk by rule; returning the full text a second time
puts it into the main session's context, where it is then re-read on every
later turn. The main session is 27% of this feature's input tokens, more than
any agent role except the engineers, and that is what most of it is. Ten lines
and the path to the file is the whole contract: verdict, blocking count, and
where to read the rest.

This is a hard cap, not a target: no pasted file contents, no blueprint
excerpts, no diffs, no findings lists in the return message, whatever the
reason feels compelling in the moment. If the summary would need more than
ten lines to be useful, the extra belongs in the file, not the message: the
main session reads the file when it needs the detail, once, not on every
later turn by way of the conversation. A follow-up feature measured this rule
"in force" and still watched the main session's share grow 27% → 32%; a rule
that erodes under its own weight needs a harder edge, not a reminder.

**An agent's report is not evidence.** When an agent returns, the main session checks the worktree before believing it: `git status --short` plus the files the blueprint said would exist. Agents have returned confident summaries for files they never wrote, and have returned nothing at all after ninety minutes of work. Both are caught by looking, and only by looking. An agent that returns without a result is resumed with an order to write the deliverable to disk before composing any prose.

## Parallelism

Stories are the unit, not features. Independent stories run at once; the dependency graph decides what is *allowed* to run in parallel, and the machine decides how many of those actually do.

**Concurrency is measured, not chosen. Between one and six, never a fixed number.** Before every dispatch:

```
sh .Codex/scripts/capacity.sh
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

A slot is held by a story's *implementation*, not by its paperwork. Once a story passes validation it merges and its slot frees immediately — nothing holds a slot open waiting on a human or on tests and documentation, because neither runs per story any more. Stories touching the same file or the same contract run sequentially, in graph order. The registry (`.Codex/registry.json`, main checkout, lock-protected) is what stops two sessions taking the same story or the same ports.

## Integration and closing

Merging is the main session's job, never a teammate's. When a story passes: merge its branch into the integration branch in dependency order, then `story.mjs state <id> done` and `story.mjs release <id>`. `release` refuses a worktree holding unmerged work; merge first, never force past it.

**Finished work goes back to its base branch immediately. This is not a gate.** A story that has passed validation with zero blocking findings is merged as soon as it passes, without asking. Asking costs a round trip and leaves the branch drifting from a base that other stories are still moving; the user's instruction is that anything finished is always carried back to the branch it started from. The two things that still stop a merge are a blocking finding and a genuine conflict, and both are work, not permission.

Two mechanical notes, both learned by hitting them:

- **commitlint runs on merge commits.** `merge(RA-07): ...` is rejected: the type must be one of the conventional set. Use the type of the change being merged (`fix`, `feat`, `docs`) and name the branch in the body.
- **`story.mjs state` has `merging` and `blocked` for a reason.** `capacity.sh` counts only `in-progress` against the machine's slots. A story that has passed and is waiting to merge is `merging`; a story parked on CI or an external gate is `blocked`. Leaving either at `in-progress` makes the capacity script refuse dispatches the machine could have carried, which is how this feature spent a stretch reporting "dispatch 0 more" with nothing actually running.

## Feature-level user-check gate

Once every story that can merge locally has merged (`git branch --merged <base>` against what the analysis scoped), stop dispatching and report to the user: what merged, what's blocked and why, and how to run and test the integration branch themselves. This is the feature's one formalization gate — nothing past it runs without the user's go-ahead, and it replaces asking per story, which was slower and produced the same information in smaller, more expensive pieces.

On go-ahead: dispatch **qa-engineer** and **docs-writer** against the integration branch, covering everything the feature shipped, in parallel with each other. They commit directly to the integration branch; no story worktree is reopened for this. Then the retrospective, below.

A feature closes when every story is done, the integration branch builds and its tests pass, and the user approves. Specs stay on disk after closing: they are gitignored and they are the record of why the code looks the way it does.

**Human gates: two.** The analyst's questions, and the single feature-level user-check gate above, before qa-engineer and docs-writer. Everything else runs without asking.

## Retrospective

**Every merged story gets a retrospective entry, written by the main session, appended to `.Codex/specs/<feature>/04-retrospective.md` at merge time.** This is a phase of the process, not a courtesy. A feature does not close without it.

The entry answers four questions and nothing else:

1. **Where did the wall-clock and the tokens actually go?** From
   `node .Codex/scripts/agent-cost.mjs`, never from memory. It reports minutes,
   tokens in and tokens out for every point in the process, per story and per
   role, plus resumes and stalls. The first time it was run it contradicted the
   entry written from impressions the day before: stalls were 10% of the cost,
   not the headline, and one story out of eighteen was 37%.

   Run it before the agents' own transcripts are reaped. Nested agents, which is
   to say the engineers, exist nowhere else.
2. **What was rework?** An agent that stalled and needed resuming, a blueprint corrected mid-flight, a validator round that a better prompt would have made unnecessary, two agents solving the same problem twice in different places. Name it and say what it cost.
3. **What changes because of it?** A concrete edit: to this file, to an agent definition, to a skill, to a blueprint template. If nothing changes, write "nothing changes" and the reason. A retrospective whose every entry is "went well" is not being written honestly.
4. **What is now known that the next story should not rediscover?** Goes to `.ai/memory.md` if it is about the code, stays here if it is about the process.

The rule that makes it worth anything: **a lesson that does not become an edit is not a lesson.** If three stories in a row report the same waste, the process is what is broken, and fixing it takes priority over the next story.

Report the retrospective to the user in chat when it is written. The user is the one deciding whether the process is worth what it costs, and cannot decide that from a file they were never shown.

**Interrupt policy**: stop and explain only when a story is unachievable for architectural or irreversible reasons. Give the exact problem, why it blocks, and the options with tradeoffs. Never interrupt for ordinary implementation difficulty: the remediation loop handles that.
