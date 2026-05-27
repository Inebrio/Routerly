---
name: self-improvement
description: "Captures learnings, errors, and corrections to enable continuous improvement. Use when: (1) a command or operation fails unexpectedly, (2) the user corrects you ('No, that's wrong...', 'Actually...'), (3) a capability is requested but missing, (4) an external API or tool fails, (5) knowledge turns out to be outdated, (6) a better approach is discovered for a recurring task. Also review learnings before major tasks."
---

> **Deprecated — superseded by `ai/skills/autoimprove/SKILL.md`**
> The active continuous-improvement workflow (Hook 1 + Hook 2, log formats,
> promotion rules) lives there. Refer to that file for all new work.

# Self-Improvement — Routerly

Log learnings and errors to `ai/learnings/` for continuous improvement.
Promote broadly applicable insights to `ai/memory/` or the Routerly entrypoint files.

---

## Quick reference

| Situation | Action |
|-----------|--------|
| Command/operation fails | Log to `ai/learnings/ERRORS.md` |
| User corrects you | Log to `ai/learnings/LEARNINGS.md` with category `correction` |
| User requests missing feature | Log to `ai/learnings/FEATURE_REQUESTS.md` |
| External API/tool fails | Log to `ai/learnings/ERRORS.md` |
| Knowledge was outdated | Log to `ai/learnings/LEARNINGS.md` with category `knowledge_gap` |
| Better approach found | Log to `ai/learnings/LEARNINGS.md` with category `best_practice` |
| Learning applies broadly | Promote to `ai/memory/` or entrypoint files — see table below |

---

## Setup

```bash
mkdir -p ai/learnings
```

---

## Log formats

### Learning entry — append to `ai/learnings/LEARNINGS.md`

```markdown
## [LRN-YYYYMMDD-XXX] category

**Logged**: ISO-8601
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: service | dashboard | cli | shared | ci | docs | config

### Summary
One-line description

### Details
What happened, what was wrong, what is correct.

### Suggested Action
Specific fix or improvement.

### Metadata
- Source: conversation | error | user_feedback
- Related Files: path/to/file.ts
- Tags: tag1, tag2

---
```

### Error entry — append to `ai/learnings/ERRORS.md`

```markdown
## [ERR-YYYYMMDD-XXX] skill_or_command_name

**Logged**: ISO-8601
**Priority**: high
**Status**: pending
**Area**: service | dashboard | cli | shared | ci | docs | config

### Summary
What failed.

### Error
```
Actual error message
```

### Context
- Command attempted
- Input/parameters used

### Suggested Fix
If identifiable.

### Metadata
- Reproducible: yes | no | unknown
- Related Files: path/to/file.ts

---
```

### Feature request entry — append to `ai/learnings/FEATURE_REQUESTS.md`

```markdown
## [FEAT-YYYYMMDD-XXX] capability_name

**Logged**: ISO-8601
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

---

## ID format

`TYPE-YYYYMMDD-XXX` — e.g. `LRN-20260507-001`, `ERR-20260507-A3F`

- `LRN` = learning, `ERR` = error, `FEAT` = feature request
- `XXX` = sequential number or random 3 chars

---

## Resolving entries

When fixed, update the entry status:

```markdown
**Status**: resolved

### Resolution
- **Resolved**: ISO-8601
- **Commit**: abc123
- **Notes**: What was done.
```

Other statuses: `in_progress`, `wont_fix`, `promoted`.

---

## Promotion to project memory

Promote when a learning is broadly applicable — any contributor should know it.

| Target | What belongs there |
|--------|--------------------|
| `ai/memory/constraints.md` | New non-negotiable constraint or implementation status update |
| `ai/memory/decisions.md` | Architectural decision with rationale (e.g., why a policy was chosen) |
| `ai/memory/project.md` | Immutable project fact (version, endpoints, stack) |
| `ai/context/architecture.md` | Correction to request flow, routing engine, or provider adapter behaviour |
| `ai/context/database.md` | New JSON file in `ROUTERLY_HOME` or schema change |
| `ai/context/api.md` | New or changed management/proxy endpoint |
| `ai/policies/security.md` | New security rule or discovered vulnerability |
| `AGENTS.md` | Agent-level workflow or automation rule |
| `CLAUDE.md` | Fact or convention for Claude interactions |
| `.github/copilot-instructions.md` | Project context for Copilot |

**How to promote:**
1. Distill into a concise rule or fact.
2. Add to the appropriate section in the target file.
3. Update the original entry: `**Status**: promoted`, add `**Promoted**: ai/memory/constraints.md` (or whichever file).

---

## Detection triggers

**Corrections** → `correction` category:
- "No, that's not right…", "Actually, it should be…", "That's outdated…"
- The spec says X but the code does Y
- A routing policy behaves differently than documented in `ai/context/architecture.md`

**Feature requests** → feature request entry:
- "Can you also…", "I wish you could…", "Why can't you…"

**Knowledge gaps** → `knowledge_gap` category:
- A provider adapter behaves differently than expected
- `ROUTERLY_HOME` file schema has changed
- An endpoint listed in `ai/context/api.md` no longer exists or has a different signature
- A constraint in `ai/memory/constraints.md` is marked as unimplemented but has since been implemented

**Errors** → error entry:
- Non-zero exit code in `npm test`, `npm run build`, `npm run typecheck`
- A Vitest test fails for a non-obvious reason
- `proper-lockfile` throws on a concurrent write to a config file
- A provider HTTP call returns an unexpected format

---

## Periodic review

Review `ai/learnings/` at natural breakpoints: before a major task, after completing a feature, or when working in an area with past learnings.

```bash
# Count pending items
grep -h "Status\*\*: pending" ai/learnings/*.md | wc -l

# List high-priority pending items
grep -B5 "Priority\*\*: high" ai/learnings/*.md | grep "^## \["
```

---

## Best practices

1. **Log immediately** — context is freshest right after the issue.
2. **Be specific** — future agents need to understand quickly.
3. **Suggest concrete fixes** — not just "investigate".
4. **Promote aggressively** — when in doubt, add to `ai/memory/` or entrypoint files.
5. **Review before major tasks** — stale learnings lose value.
