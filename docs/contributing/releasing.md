---
title: Releasing
sidebar_position: 1
---

Routerly ships four packages together: `@routerly/service`, `@routerly/cli`,
`@routerly/dashboard` and `@routerly/shared`. They always carry the same
version number. This page covers the whole release path. The first part is what a
contributor is expected to do: recording a changeset. The second is the
maintainer procedure, which grows as more of the pipeline is automated.

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

---

# Maintainer procedure

Everything below is run by a maintainer cutting a release, not by a
contributor opening a pull request.

## Cutting a documentation version

The documentation site (`website/`, built with Docusaurus) keeps a
snapshot of `docs/` for every past release, plus one always-current
"next" version. Cutting a new documentation version freezes the current
`docs/` content as a new, independently browsable snapshot and moves the
"latest" label onto it.

Run this once, at release promotion, from the repository root:

```bash
npm run docs:cut -- <X.Y.Z>
```

`<X.Y.Z>` is the bare release version: no `v` prefix, no pre-release
suffix. Example:

```bash
npm run docs:cut -- 1.4.0
```

### What it does

1. Reads and validates the version argument.
2. Refuses if that version has already been cut.
3. Confirms `website/docusaurus.config.ts` has exactly one rewritable
   `lastVersion` line, before touching anything.
4. Installs `website/`'s dependencies if `website/node_modules` is
   missing (`npm ci --prefix website`).
5. Runs the Docusaurus versioning CLI (`docusaurus docs:version <X.Y.Z>`),
   which:
   - copies `docs/` into `website/versioned_docs/version-<X.Y.Z>/`
   - copies `website/sidebars.ts` into
     `website/versioned_sidebars/version-<X.Y.Z>-sidebars.json`
   - prepends `<X.Y.Z>` to `website/versions.json`
6. Rewrites the `lastVersion: '...'` line in
   `website/docusaurus.config.ts` to the new version, so the site's
   "latest" label points at what was just cut. The always-current
   in-progress content in `docs/` is untouched and stays reachable as
   `next`.

A successful run prints the new contents of `website/versions.json`:

```
$ npm run docs:cut -- 1.4.0
...
[SUCCESS] [docs]: version 1.4.0 created!
Cut documentation version 1.4.0

website/versions.json:
[
  "1.4.0",
  "1.3.0",
  "1.2.0"
]
```

Exit code `0`. The only file changed outside `website/versioned_docs/`,
`website/versioned_sidebars/` and `website/versions.json` is
`website/docusaurus.config.ts`, and the diff on it is exactly one line:

```
-          lastVersion: '1.3.0',
+          lastVersion: '1.4.0',
```

Run it again for the next release when the time comes; each run is
independent and does not touch a previously cut version's directory.

### Refusals

Every refusal writes nothing to disk and exits `1` with a message on
stderr. Order matters: the script validates the argument, then checks
whether the version is already cut, then checks the config shape, before
anything is installed or run. A doomed invocation never leaves a
half-cut version behind.

| Situation | stderr message | How to get past it |
|---|---|---|
| No version given | `Missing version argument. Usage: npm run docs:cut -- <X.Y.Z>` | Pass a version: `npm run docs:cut -- 1.4.0`. |
| Version has a `v` prefix | `Version must not have a "v" prefix. Use "1.4.0" instead of "v1.4.0".` | Drop the `v`: `npm run docs:cut -- 1.4.0`. |
| Version is not bare `X.Y.Z` | `Malformed version "1.4". Expected bare semver in the form X.Y.Z (e.g. 1.2.3).` | Use exactly three numeric components, no pre-release or build metadata: `npm run docs:cut -- 1.4.0`. |
| Version already cut | `Version 1.4.0 is already cut (present in website/versions.json).` | This is not a re-run path. If the cut version's content is wrong, fix it by hand in `website/versioned_docs/version-1.4.0/` (or remove the version and cut again), not by re-running this command. |
| `website/docusaurus.config.ts` has no `lastVersion: '...'` line, or more than one | `Could not find a single "lastVersion: '...'" line in website/docusaurus.config.ts (found 0).` (or `found 2`) | The config's `lastVersion` line has been renamed, removed, duplicated or reshaped. Restore a single `lastVersion: '<version>',` line in the plugin options of `website/docusaurus.config.ts`, or update `LAST_VERSION_LINE_RE` in `scripts/docs-version.mjs` to match the new shape. |
| Dependency install fails | `Failed to install website dependencies (npm ci --prefix website).` | Only shown when `website/node_modules` is missing. Run `npm ci --prefix website` yourself and inspect its output; the underlying npm error prints above this line. |
| Docusaurus CLI itself fails | `Docusaurus CLI failed to cut version <X.Y.Z>.` | The Docusaurus CLI's own output prints above this line; the version was not added to `website/versions.json`. |

### Known limitation

If the Docusaurus CLI succeeds (`versions.json` and
`versioned_docs/version-<X.Y.Z>/` written) but the subsequent rewrite of
`website/docusaurus.config.ts` fails at the filesystem level (disk full,
permission denied), the version is cut but `lastVersion` was not moved to
it. This window is a plain OS-level write failure, not a defect in the
script's logic; if it happens, check `website/docusaurus.config.ts` by
hand and fix `lastVersion` yourself.

### Verifying a cut locally

```bash
npm run build --prefix website
npm run serve --prefix website -- --port <port> --no-open
```

Open the site and use the version switcher in the nav: the new version
and `next` (the always-current, in-progress documentation) are both
listed and each shows its own version banner.

## Rebuilding a Docker image

The published image can lag the code it was built from: a base image gets a
security patch, a build step needs to run again, or a past release's image
turns out to have shipped with a broken layer. The **Docker Rebuild**
workflow (`.github/workflows/docker-rebuild.yml`) rebuilds and republishes
the image for a version that has already been released, without cutting a
new version and without going through the normal release pipeline.

### Triggering it

It only runs on manual dispatch, from the Actions tab (**Docker Rebuild** →
**Run workflow**) or with the GitHub CLI:

```bash
gh workflow run docker-rebuild.yml -f version=1.4.0
```

The `version` input is optional and accepts either shape, `v1.4.0` or
`1.4.0`. Leave it empty and the workflow reads the version straight out of
`packages/service/package.json` instead.

### What it writes, and what it leaves alone

The workflow always pushes `inebrio/routerly:v<X.Y.Z>` for the version you
gave it, rebuilt for both `linux/amd64` and `linux/arm64`. That part is
unconditional: rebuilding `1.2.0` always overwrites `inebrio/routerly:v1.2.0`.

`inebrio/routerly:latest` is different. The workflow reads every `vX.Y.Z`
tag in the repository's git history, keeps the highest one, and moves
`:latest` only if the version you are rebuilding is that highest version (or
if no release tag exists yet at all). Rebuild the current newest release and
`:latest` moves with it, as expected. Rebuild an older one, say `1.2.0` when
`1.4.0` has since shipped, and only `inebrio/routerly:v1.2.0` is written;
`inebrio/routerly:latest` still points at `1.4.0` and the workflow does not
touch it. This is the whole point of the workflow: fixing an old image must
never make an old image look like the newest one to anyone who pulls
`:latest`.

Pre-release tags (`vX.Y.Z-rc.N`) are not counted when the workflow looks for
the highest version: it only reads tags shaped `vX.Y.Z`, plain semver, so a
release candidate hanging around never becomes what an old rebuild is
compared against.

### Refusals

The workflow validates the version before doing anything else — no checkout
of Docker Hub credentials or build step runs on a bad input. Given a
version that is not `vX.Y.Z` or `X.Y.Z` (`latest`, `0.2`, `1.4.0.0`), it
fails the run with:

```
::error::Invalid version 'latest' — accepted shapes are vX.Y.Z or X.Y.Z
```

and pushes nothing. There is no partial state to clean up: the tag decision
and the build both happen after this check passes.
