---
name: "source-command-commit"
description: "Analyze the staged diff and write a conventional commit message, then commit."
---

# source-command-commit

Use this skill when the user asks to run the migrated source command `commit`.

## Command Template

Look at the current git diff (staged and unstaged). Write a conventional commit message:

`type(scope): description`

- `type`: feat | fix | chore | refactor | test | docs | ci | perf
- `scope`: service | dashboard | cli | shared | docs | ci | config
- `description`: lowercase, imperative, no period, max 72 chars

Rules:
- Never use `--no-verify`
- Multiple packages → use most impacted scope
- Breaking change or non-obvious motivation → add blank line + body

Show the message, then ask before running `git commit`.
