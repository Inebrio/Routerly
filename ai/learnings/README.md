# ai/learnings/

This directory is the **staging area** for agent learnings before promotion.

Entries captured here during tasks are reviewed before promotion to permanent
files in `ai/memory/`, `ai/context/`, `ai/policies/`, or the entrypoint files.

**Files:**
- `LEARNINGS.md` — corrections, knowledge gaps, best practices
- `ERRORS.md` — unexpected errors and failing commands
- `FEATURE_REQUESTS.md` — capabilities the user requested that didn't exist

See `ai/skills/autoimprove/SKILL.md` for the full workflow and log formats.

**Review commands:**
```bash
# Count pending items
grep -rh "Status\*\*: pending" ai/learnings/*.md 2>/dev/null | wc -l

# List high-priority pending
grep -B5 "Priority\*\*: high\|Priority\*\*: critical" ai/learnings/*.md 2>/dev/null | grep "^## \["
```
