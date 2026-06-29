---
description: Guide through creating a Changesets entry for the next release.
---

1. Run `git diff main...HEAD --name-only` to see changed packages
2. Identify which need a bump: `packages/service`, `packages/dashboard`, `packages/cli`, `packages/shared`
3. Determine bump type:
   - `patch`: bug fix, dependency update, docs
   - `minor`: new feature, new endpoint, new CLI command
   - `major`: breaking API change, removed endpoint, incompatible config change
4. Write a 1-2 sentence user-visible summary

All 4 packages version synchronously — always bump all at the same level.

Then run `npm run changeset` and fill in the prompts.
