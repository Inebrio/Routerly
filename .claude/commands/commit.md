---
description: Analyze the staged diff and write a conventional commit message, then commit.
---

Look at the current git diff (staged and unstaged). Write a conventional commit message following this format:

`type(scope): description`

Where:
- `type`: feat | fix | chore | refactor | test | docs | ci | perf
- `scope`: service | dashboard | cli | shared | docs | ci | config
- `description`: lowercase, imperative, no period at end, max 72 chars

Rules:
- Never use `--no-verify`
- If there are test files changed, mention it in the body
- If the change affects more than one package, use the most impacted scope
- Add a blank line + body if the change needs explanation (breaking change, non-obvious motivation)

Show me the commit message you'd write, then ask if I want to proceed before running `git commit`.
