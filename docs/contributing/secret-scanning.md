---
title: Secret scanning
sidebar_position: 2
---

Routerly scans for committed secrets with [gitleaks](https://github.com/gitleaks/gitleaks) at three points. Findings are always redacted: the secret value is never printed, not even in CI logs.

| Where | What is scanned | Blocks |
|---|---|---|
| `pre-commit` hook | staged changes | the commit |
| `pre-push` hook | commits being pushed | the push |
| CI job `Secret scan` | commits of the PR, or of the push to `main`, `next`, `develop` | the merge, once the check is required on the branch |

The hooks need `gitleaks` on your `PATH` ([install](https://github.com/gitleaks/gitleaks#installing)). Without it they print a warning and skip: CI is the mandatory gate. Both hooks and CI run `scripts/secret-scan.sh`.

Rules live in `.gitleaks.toml` (gitleaks defaults plus an allowlist). Docs, tests and locale files may contain placeholder credentials, so only the generic heuristics (`generic-api-key`, `curl-auth-header`, `aws-access-token`) are relaxed there; vendor-specific rules stay active everywhere. To allow a real false positive, add the narrowest path or `# gitleaks:allow` on the line.

If a secret was committed: revoke it first, then rewrite history. Rewriting alone does not undo exposure.

## Forks and old clones

After the history rewrite that followed issue #140, any fork or clone created before it still holds the old history. Public forks of `Inebrio/Routerly` (16 at the time of writing, list with `gh api repos/Inebrio/Routerly/forks --paginate --jq '.[].full_name'`) cannot be edited by the maintainers. Decision: the exposed credential was revoked, so the old history carries no live secret and no action is taken on third-party forks; the maintainer's own clones are re-cloned from the rewritten history. Re-check the fork list when a new secret incident happens.
