---
title: Branches
sidebar_position: 2
---

How branches are named, how long they live and who deletes them. The rules
apply to the main repository and to every component repository.

## Permanent branches

| Branch | Purpose |
|---|---|
| `main` | Stable channel. Releases are cut from it. |
| `next` | Pre-release channel. |
| `develop` | Default branch, development channel. |
| `release/X.Y.Z` | Integration branch of one release. Kept after the release ships. |
| `gh-pages` | Published documentation site. |
| `docs-versions` | Documentation cuts layered onto the site by `release.yml` and `docs-deploy.yml`. Never delete. |

Component repositories keep `main` and `release/X.Y.Z` (the benchmark repo also keeps `develop`).

## Work branches

- `feature/ROUT-N-slug` — one branch per work item. The slug comes from the
  item title: lower case, hyphens, no accents, at most 40 characters.
- `hotfix/ROUT-N` — a fix that must reach `develop`, `next` or `main`
  without waiting for a release.
- Branches created before this standard (`feature/ROUT-N` without slug) stay
  valid and are never renamed.
- Contributors work on their own fork. Branches of external pull requests are
  never created on `origin`.

Every other name on `origin` (`feat/…`, `fix/…`, `chore/…`, `backup/…`,
`story/…`, bare names) is out of standard and is treated as a leftover.

## Lifetime and deletion

- A work branch is temporary. When the item reaches Completed and its branch
  is contained in the release branch, `rtr` deletes it on `origin` and locally.
- A branch that is **not** merged is never deleted before a tag
  `archive/<branch-name>` points at its tip and is pushed.
- Never deleted: permanent branches, branches with an open pull request,
  branches with an active worktree, branches of an item still in progress.

## Checking and cleaning

```bash
rtr branch audit [--repo code|<component>] [--csv branches.csv]
rtr branch clean --list approved.csv          # dry run
rtr branch clean --list approved.csv --apply  # tags unmerged branches, then deletes
```

`audit` is read-only and classifies each branch as `permanente`, `vivo`,
`mergiato-da-cancellare`, `non-mergiato-archivia` or `fuori-standard`.
`clean` only touches the branches in the approved list (columns `repo`,
`branch`) and skips the protected ones.
