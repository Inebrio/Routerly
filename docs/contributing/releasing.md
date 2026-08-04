---
title: Releasing
sidebar_position: 1
---

Routerly ships four packages together: `@routerly/service`, `@routerly/cli`,
`@routerly/dashboard` and `@routerly/shared`. They always carry the same
version number. This page covers the part of the release process a
contributor is expected to do: recording a changeset. The rest of the
pipeline (cutting the release branch, publishing Docker images, deploying
the docs site) is a maintainer task and out of scope here.

## Recording a changeset

If your change is user-visible, add a changeset before opening a pull
request:

```bash
npx changeset
```

This prompts you for which packages your change touches and which kind of
version bump it deserves, then writes a markdown file under `.changeset/`
that you commit alongside your code. That file is both the version bump
instruction and the changelog entry: whatever you write in the prompt ends
up verbatim in each affected package's `CHANGELOG.md`.

Pick the bump type honestly:

- **patch** — a bug fix, with no change to any documented behaviour.
- **minor** — a new feature, flag, endpoint or option; anything additive.
- **major** — a breaking change to the wire format, the CLI, the API or the
  configuration shape.

Because all four packages move together, `changeset` will bump every
package you select to the same new number, not each to its own. Do not try
to release, say, only `@routerly/cli` at a new minor while leaving the
others untouched. If your change only touches one package's code, you can
still record the changeset against just that package: the version number
that results still applies to all four, since they are always published
together.

Skip the changeset only for changes with nothing for a user or operator to
notice: internal refactors, test-only changes, CI and tooling. If you are
unsure, add one.

## What happens after you push

Pushing to a `release/**` branch triggers a GitHub Actions workflow that
opens or updates a pull request against that same release branch. This is
the **Version PR**. Its title is "chore: version packages", and it does two
things once merged: it applies every pending changeset's version bump to
all four packages at once, and it writes each affected package's
`CHANGELOG.md` from the changeset files.

The Version PR is not a proposal you can safely apply by hand. **Merging it
is what performs the bump.** Nobody commits a version number directly:
a script does not decide the number, a human reviews and merges it. This
matters because the version is the one part of a release that cannot be
corrected after the fact without breaking instances that already installed
it. A wrong or accidental commit to `package.json` skips that review; the
Version PR exists so a human always looks at the exact number and the exact
changelog before it becomes real.

If you push more changesets to the same release branch after the Version
PR has already opened, it updates in place. You do not need to open a
second one, and you should not close the first one manually while waiting
for a second push.

A release branch with nothing pending simply gets no Version PR. Pushing
code that has no changeset attached does not produce an empty or broken
one.

## Prerelease mode is not used on this line

Routerly does not cut release-candidate versions (`vX.Y.Z-rc.N`) through
changesets' own prerelease mode. If a `.changeset/pre.json` file exists on
a `release/**` branch, the version workflow refuses to run and fails with:

```
Prerelease mode is not used on this line. Exit it with 'npx changeset pre exit' before pushing this release branch.
```

If you hit this, someone left prerelease mode enabled from an earlier,
unrelated experiment. Run `npx changeset pre exit` on that branch and push
again; the version is decided once, in full, not incrementally through
release-candidate identifiers.

## Checking what would be released

To see the pending version bump for the packages on your current branch
without applying it:

```bash
npx changeset status
```

This compares against the branch the current line of development was cut
from, not against a fixed default, so run it from a checkout of the branch
you are actually about to release from.
