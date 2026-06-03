---
name: autoimprove
description: >
  Mandatory continuous-improvement hooks for every multi-step task.
  Run Hook 1 (pre-task) BEFORE starting any task to avoid repeating past
  mistakes. Run Hook 2 (post-task) AFTER completing any task to capture new
  learnings. Also triggered when: a test fails unexpectedly, the user corrects
  the agent, an API/type is wrong, or a document turns out to be outdated.
---

# Autoimprove — Continuous improvement

> This skill is **not optional**. It runs as a before/after wrapper around every
> multi-step task. Its goal: make the agent smarter with each session by
> capturing learnings in `ai/learnings/` and promoting broadly applicable ones
> to the permanent `ai/` knowledge base.

---

## Hook 1 — Pre-task review

Run this **before starting** any multi-step task.

```bash
# Check if ai/learnings/ has anything relevant
ls ai/learnings/ 2>/dev/null || echo "No ai/learnings/ yet — skip review"
grep -rh "Status\*\*: pending" ai/learnings/*.md 2>/dev/null | wc -l
```

Steps:

1. Identify the area(s) this task touches: `service`, `dashboard`, `cli`, `shared`, `ci`, `docs`
2. Run: `grep -l "Status\*\*: pending" ai/learnings/*.md 2>/dev/null`
3. Read entries whose `**Area**` matches the current task area
4. For entries with `Priority: critical` or `high` — either address them first or
   explicitly note why they don't apply to this task
5. Note patterns to avoid before writing a single line of code

If `ai/learnings/` is empty or absent: skip and proceed.

---

## Hook 2 — Post-task capture

Run this **after completing** any multi-step task, before calling `task_complete`.

Go through this checklist. Skip items that don't apply.

| Situation | Action |
|-----------|--------|
| A test failed before I fixed it | Log to `ai/learnings/ERRORS.md` |
| User corrected me ("actually…", "no, that's wrong…") | Log to `ai/learnings/LEARNINGS.md` — category `correction` |
| I used a wrong import / API / type | Log to `ai/learnings/LEARNINGS.md` — category `knowledge_gap` |
| A document in `ai/` was outdated | Update the doc, then log — category `knowledge_gap` |
| I found a better/faster approach | Log to `ai/learnings/LEARNINGS.md` — category `best_practice` |
| User requested something that didn't exist | Log to `ai/learnings/FEATURE_REQUESTS.md` |
| None of the above | Task was clean — no action needed |

Then check: **should any entry be promoted?** (see Promotion rules below)

---

## Log formats

### LEARNINGS.md entry

Append to `ai/learnings/LEARNINGS.md`:

```markdown
## [LRN-YYYYMMDD-XXX] category

**Logged**: 2026-05-27T00:00:00Z
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: service | dashboard | cli | shared | ci | docs | config

### Summary
One-line description.

### Details
What happened, what was wrong, what is correct.

### Suggested Action
Specific fix or improvement to apply.

### Metadata
- Source: conversation | error | user_feedback
- Related Files: packages/service/src/foo.ts
- Tags: imports, routing, auth

---
```

Categories: `correction`, `knowledge_gap`, `best_practice`, `missing_context`

### ERRORS.md entry

Append to `ai/learnings/ERRORS.md`:

```markdown
## [ERR-YYYYMMDD-XXX] skill_or_command

**Logged**: 2026-05-27T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: service | dashboard | cli | shared | ci | docs | config

### Summary
What failed.

### Error
```
Actual error message or exit code
```

### Context
- Command/operation attempted
- Inputs or parameters used

### Suggested Fix
Specific fix if identifiable.

### Metadata
- Reproducible: yes | no | unknown
- Related Files: packages/service/src/foo.ts

---
```

### FEATURE_REQUESTS.md entry

Append to `ai/learnings/FEATURE_REQUESTS.md`:

```markdown
## [FEAT-YYYYMMDD-XXX] capability_name

**Logged**: 2026-05-27T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: service | dashboard | cli | shared | ci | docs | config

### Requested Capability
What the user wanted.

### User Context
Why they needed it.

### Complexity Estimate
simple | medium | complex

### Suggested Implementation
How this could be built.

### Metadata
- Frequency: first_time | recurring

---
```

### ID format

`TYPE-YYYYMMDD-XXX` — e.g. `LRN-20260527-001`, `ERR-20260527-A3F`

Use sequential numbers or short random hex. Uniqueness within the file is enough.

---

## Promotion rules

Promote an entry from `ai/learnings/` to the permanent `ai/` knowledge base when:

- The learning applies to **any contributor**, not just one session
- It **corrects** something already documented in `ai/`
- It **prevents a class of recurring errors**

| Target file | What belongs there |
|-------------|-------------------|
| `ai/memory/constraints.md` | New non-negotiable constraint |
| `ai/memory/decisions.md` | Architectural decision with rationale |
| `ai/memory/project.md` | Immutable project fact (version, port, stack) |
| `ai/context/architecture.md` | Correction to request flow or provider behaviour |
| `ai/context/api.md` | New or changed endpoint |
| `ai/context/database.md` | New JSON file in `ROUTERLY_HOME` or schema change |
| `ai/policies/security.md` | New security rule or discovered vulnerability |
| `ai/policies/coding-style.md` | New coding convention |
| `AGENTS.md` | Agent-level workflow or automation rule |
| `CLAUDE.md` | Convention for Claude interactions |
| `AGENTS.local.example.md` | Local environment or tooling fact |

After promoting:
1. Distill into a concise rule or fact (1–3 lines)
2. Add to the appropriate section in the target file
3. Update the original entry: `**Status**: promoted` + `**Promoted to**: ai/memory/constraints.md`

---

## Resolving entries

When a pending entry is fixed or no longer relevant:

```markdown
**Status**: resolved

### Resolution
- **Resolved**: 2026-05-27T00:00:00Z
- **Commit**: abc1234
- **Notes**: What was done to fix it.
```

Other valid statuses: `in_progress`, `wont_fix`, `promoted`.

---

## Periodic review

Run at natural breakpoints — before a major feature, after a release, when something
feels off:

```bash
# Count pending items
grep -rh "Status\*\*: pending" ai/learnings/*.md 2>/dev/null | wc -l

# List high/critical pending items
grep -B5 "Priority\*\*: high\|Priority\*\*: critical" ai/learnings/*.md 2>/dev/null | grep "^## \["

# Find promotable items (pending + area matches current work)
grep -A3 "Status\*\*: pending" ai/learnings/LEARNINGS.md 2>/dev/null
```

Stale entries (pending for >2 weeks with no action) should be resolved as `wont_fix`
or promoted — don't let the backlog grow silently.

---

## Integration with project workflows

### In `ai/workflows/feature-development.md`

- **Before Step 0**: run Hook 1 (pre-task review)
- **After Step 4 (tests pass)**: run Hook 2 (post-task capture)

### In `ai/workflows/bugfix.md`

- **Before Step 0 (reproduce)**: run Hook 1 — check if error was seen before
- **After Step 4 (verify)**: run Hook 2 — capture the root cause and fix pattern

---

## Best practices

1. **Log immediately** — context is richest right after the issue
2. **Be specific** — include exact file paths, error messages, commands
3. **Suggest a concrete fix** — not "investigate later"
4. **Promote aggressively** — if it could help a future agent, it belongs in `ai/`
5. **Review before diving in** — stale learnings that are wrong are worse than none; mark resolved
6. **One entry per distinct issue** — don't bundle unrelated learnings
