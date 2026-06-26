---
description: Guide through creating a Changesets entry for the next release.
---

Help me create a Changesets entry for the pending changes on this branch.

Steps:
1. Run `git diff main...HEAD --name-only` to see what packages changed
2. Determine which packages need a version bump: `packages/service`, `packages/dashboard`, `packages/cli`, `packages/shared`
3. Determine bump type:
   - `patch`: bug fix, dependency update, docs
   - `minor`: new feature, new endpoint, new CLI command
   - `major`: breaking API change, removed endpoint, incompatible config change
4. Write a short summary (1-2 sentences) describing the user-visible change

All 4 packages are versioned synchronously — always bump all of them at the same level.

Then run: `npm run changeset` and fill in the prompts, or show me the `.changeset/<id>.md` content to create manually.
