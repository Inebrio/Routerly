---
title: Releasing
sidebar_position: 1
---

Routerly ships four packages together: `@routerly/service`, `@routerly/cli`,
`@routerly/dashboard` and `@routerly/shared`. They always carry the same
version number. This page covers the whole release path. The first part is
what a contributor is expected to do: write a conventional commit. The
second is the maintainer procedure, which grows as more of the pipeline is
automated.

## Write a conventional commit

There is no separate step to declare a changelog entry, and commits do not
decide the version: the maintainer types the version when dispatching the
release (see [Triggering a release](#triggering-a-release)). The commit
message feeds the GitHub release notes, which are rendered from the commit
range since the previous release.

Your commit's type must be one of the eleven `commitlint.config.js` allows:
`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`. The type decides where the change shows up in the
release notes: `feat` under **Features**, `fix` under **Bug Fixes**, `perf`
under **Performance**, `docs` under **Documentation**, `refactor` under
**Refactor**. `chore`, `ci`, `build`, `test`, `style` and `revert` produce
no heading and no bullet; they stay out of what a reader sees changed.

Mark a breaking change with a `!` after the type/scope (`feat!:`) or a
`BREAKING CHANGE:` footer so the maintainer sees it when choosing the
version. `commitlint` enforces the type list and a lower-case subject on
every commit via a Husky hook, but not the breaking marker: that is on the
author.

## Reference the issue you're closing

If a commit resolves a GitHub issue, say so in the body: `Closes #NNN`,
`Fixes #NNN`, or `Resolves #NNN`. `develop` is this repository's default
branch, so a commit using that syntax auto-closes the issue the moment it
lands there — no separate close step. A commit that fixes something without a tracked issue needs
nothing extra.

## Stamping a branch

The publish job does not commit the bumped version back, so the
`package.json` files in git go stale and any build from a branch (review
instance, UAT) reports that stale number in Settings → About. When cutting
`release/X.Y.Z`, stamp it once:

```bash
npm version X.Y.Z --allow-same-version --workspaces --include-workspace-root --no-git-tag-version --ignore-scripts
node scripts/sync-module-versions.mjs
```

Commit as `chore: stamp version X.Y.Z`. The publish job overwrites it with the version typed at dispatch.

## Module manifests carry the product version, not their own

Every module under `packages/service/src/modules/` declares a
`manifest: { id, version, dependsOn }`. That `version`, and every
`^X.Y.Z` range inside `dependsOn`, is rewritten to the current product
version on every release (see "Keeping module manifests in sync" below).
Whatever you type there when adding or editing a module is temporary: it
gets replaced.

Do not hand-pick a version number for a module manifest or a `dependsOn`
range. Write any valid `X.Y.Z` placeholder; the release version script
overwrites it unconditionally.

In tests, do not assert against a literal version string. Import
`PRODUCT_VERSION` from `packages/service/src/core/version.ts` and assert
against that instead:

```ts
import { PRODUCT_VERSION } from '../../core/version.js'

expect(myModule.manifest.version).toBe(PRODUCT_VERSION)
expect(myModule.manifest.dependsOn).toEqual({ config: `^${PRODUCT_VERSION}` })
```

A test that hardcodes `'0.4.0'` breaks on the next release even though
nothing about the module changed.

---

# Maintainer procedure

Everything below is run by a maintainer cutting a release, not by a
contributor opening a pull request.

## Branches and channels

Three long-lived branches carry release meaning; everything else is ordinary
development. Each is one of three update channels, ordered from most to
least stable.

| Branch | Channel | What it means | What it runs |
|---|---|---|---|
| `main` | `current` (the Docker tag and GitHub "Latest" flag are called `latest`) | The currently shipped, stable release. | `ci.yml`, manually via `release.yml` (see [Triggering a release](#triggering-a-release)). |
| `next` | `next` | Validated pre-release line, promoted from `develop` once it has been reviewed. | `ci.yml`, manually via `release.yml`. |
| `develop` | `develop` | Bleeding-edge, unreviewed release line. Every merge to `develop` is a candidate; nothing between here and the commit history gates it. | `ci.yml`, manually via `release.yml`. |

The channel of a release is the branch it is dispatched from (`main` →
`current`, `next` → `next`, `develop` → `develop`); the mapping lives in
`scripts/ci-release-output.mjs`. Only `main` publishes a stable release
(not a prerelease, flagged "Latest").

All three branches share **one tag namespace**: every release, on any of
them, gets a single `vX.Y.Z` git tag. There is no second, channel-prefixed
tag scheme — a version tagged `v1.5.3` is the same object whether it was
first published from `develop` or later promoted onto `next` or `main`.

**Versions are chosen by hand.** Up to 0.6.0 the version was computed from the
commit history; that caused the 0.x problems
that motivated the change (a breaking change producing a major, channels
resolving different versions). Nothing computes a version any more.

**Channel names.** The CLI, the config, the management API and the
installers accept exactly five values: `latest`, `current`, `next`,
`stable`, `develop`, or a version tag such as `v0.4.0`. There are no
aliases: every value is validated and persisted verbatim.

:::warning Breaking change
`develop` used to be accepted as a deprecated alias for `next`. It is now a
real channel in its own right, the bleeding-edge line. An instance that had
`"develop"` persisted under the old meaning now tracks the bleeding-edge
line instead of `next` the next time it checks for updates.
:::

**The `stable` channel.** `stable` is a permanent channel with its own
release pointer, independent from `current`/`latest`. It is served like
`next` and `develop`: a rolling `channel-stable` prerelease whose title
`Routerly stable (→ vX.Y.Z)` carries the version. Rule:

- `current` follows every new stable release automatically.
- `stable` moves only on explicit promotion, `rtr release promote-stable
  X.Y.Z`, which dispatches the `stable-pointer` workflow
  (`.github/workflows/stable-pointer.yml`).
- Promotion refuses a release that is not already `current` or that has
  open regressions attributed to it. There is no age limit. It needs
  Carlo's approval and the `--conferma` flag.
- Until the first promotion (0.6.0, last step of ROUT-540) `channel-stable`
  does not exist: the update checker reports an error for `stable` and the
  installers fail with "Could not fetch channel 'stable'". There is no
  silent fallback to `current`.

The documentation site's own versioning is unrelated to the three update
channels above, and keeps only two live states, not three:

| Docs version | Label | What it tracks |
|---|---|---|
| Docusaurus's own unversioned `current` | "next" | The live `docs/` tree as committed — not frozen to any release, and can be ahead of the newest cut snapshot. |
| Newest entry in `website/versions.json` | default landing page | The most recently cut documentation snapshot. |

Only the `current` channel (`main`) ever cuts a documentation version — the
`docs` job in `release.yml` runs only when `channel == 'current'`. Neither
`next` nor `develop` cuts one of its own: their documentation lives only in
the always-live tree above, and gets no frozen snapshot until it is
promoted all the way to `main`. See [Cutting a documentation
version](#cutting-a-documentation-version) for the mechanics of the cut
itself.

## Triggering a release

`release.yml` has no push trigger — `on:` names only `workflow_dispatch: {}`.
Nothing runs on `git push`, to `main`, `next`, `develop`, or any other
branch. A maintainer starts a release explicitly, choosing the branch to
release from via the ref picker:

- Actions tab → **Release Pipeline** → **Run workflow** → pick the branch
  (`main`, `next` or `develop`) in the branch dropdown → **Run workflow**.
- Or from the CLI: `gh workflow run release.yml --ref <branch>`.

The workflow has one required input, `version` (`X.Y.Z`), typed by the
maintainer:

```bash
gh workflow run release.yml --ref develop -f version=0.6.1
```

The branch you pick is also what `scripts/ci-release-output.mjs` reads back
to decide the channel; it accepts exactly `main`, `next` or `develop`. The
script then chooses the action from git alone:

- tag `vX.Y.Z` does not exist: **publish**. The version must be greater
  than the highest `v*` tag reachable from the branch, otherwise the run
  fails (typo guard).
- tag `vX.Y.Z` exists: **promotion** (`addChannel`). The tag must be an
  ancestor of the branch.

## What runs automatically

One row per job in `.github/workflows/release.yml`, once a maintainer
dispatches a run (see above).

| Job | Runs when | What it produces |
|---|---|---|
| `gate` | Every dispatched run | Runs the full `ci.yml` suite as a prerequisite. Nothing downstream runs if it fails. |
| `release` | `gate` passed | Decides channel and action (see above). Publish: stamps every manifest with the typed version, builds the release tarball, renders the release notes with `scripts/release-notes.sh` (git-cliff over the commits since the previous tag), and creates the `vX.Y.Z` tag and the GitHub Release with the tarball and install scripts (prerelease unless the channel is `current`). Promotion: no new tag; on `main` the existing release loses its prerelease flag and becomes Latest. |
| `docker` | `release` published (`released == 'true'`) | Multi-arch (`linux/amd64`, `linux/arm64`) build and push. A first publish (`action == 'publish'`) builds from the release tarball and tags both the git tag and the channel tag; a later channel move (`action == 'addChannel'`) re-tags with `docker buildx imagetools create` instead of rebuilding. |
| `docs` | `release` published **and** `channel == 'current'` | Runs `npm run docs:cut` for the new version and pushes the cut to the `docs-versions` branch. Skipped entirely for a `next` or `develop` release. |
| `docs-deploy` | `docs` finished, same `channel == 'current'` gate | Builds `website/` and deploys it to Firebase Hosting. |
| `next-pointer` | `release` published **and** `channel == 'next'` | Force-moves the rolling `channel-next` git tag to the new release and recreates a same-named GitHub prerelease, attaching the install scripts. A `main`- or `develop`-published release never touches this job. |
| `develop-pointer` | `release` published **and** `channel == 'develop'` | Force-moves the rolling `channel-develop` git tag to the new release and recreates a same-named GitHub prerelease, attaching the install scripts. A `main`- or `next`-published release never touches this job. |

The pointer tags are deliberately **not** named `next`/`develop`: a tag with
the exact same name as a branch makes `git push origin <name>` ambiguous
(`dst refspec <name> matches more than one`). They are purely an internal
mechanism so the `next` and `develop` channels always have something
resolvable to install from, even though neither publishes its own `vX.Y.Z`
tag beyond the one the `release` job already created.

## Promotion and back-merge

There is no separate "promote" workflow. Promotion is a two-hop chain of
ordinary pull requests: `develop` → `next`, then `next` → `main`. Each hop
is merged by hand; the pipeline only acts once a maintainer dispatches
`release.yml` against the branch that just received the merge (see
[Triggering a release](#triggering-a-release)).

**Promotion, not recomputation.** The version is typed, so promoting a
release means dispatching the same version again on the next branch.
`develop`, on channel `develop`, has typically already published its own
`vX.Y.Z` release before the merge into `next` happens. After merging
`develop` into `next`, dispatch `release.yml` on `next` with that same
version: the tag already exists, so the run is a promotion. The release
takes over the `next` channel tag and prerelease. One hop later, after
`next` is merged into `main`, dispatching the same version on `main` flips
the release from prerelease to stable and makes it `latest`. At neither hop
is a new tag created or a second release object made.

**Worked example.** `develop` has published `1.5.3`. A maintainer merges
`develop` into `next` and dispatches `release.yml` on `next` with
`version=1.5.3`: `next` now serves **1.5.3**. The maintainer then merges
`next` into `main` and dispatches on `main` with `version=1.5.3`: `main`
serves **1.5.3** too.

### The back-merge

The direction above only carries work forward, one hop at a time. It does
not cover a fix landing directly on a branch out of order — most commonly
a hotfix committed straight to `main`, outside the normal
`develop` → `next` → `main` chain. After that happens, a maintainer must
open and merge the fix backward by hand, covering **both** gaps it
creates: `main` → `next`, then `next` → `develop`. Nothing in the pipeline
automates either hop, and nothing detects a missed one.

The same applies to the active `release/X.Y.Z` branch: a hotfix that lands on
`main` must also reach it, otherwise the next feature merged into the release
branch can reintroduce the regression. A quick check:
`git merge-base --is-ancestor origin/main origin/release/X.Y.Z` exits non-zero
when `main` holds commits the release branch lacks.

Forgetting either back-merge means the fix never reaches the branch it
skipped, and it **resurfaces as a regression the next time that branch is
promoted forward** — the promotion silently reintroduces whatever the fix
corrected, because it never reached the branch being promoted.

Automating the back-merge was rejected: a merge pushed with the workflow's
own `GITHUB_TOKEN` would not trigger a release the way a human-authored
merge followed by a manual dispatch does, so the fix would sit on the
skipped branch, unpublished on its own channel.

## Credentials the pipeline needs

Names and purposes only; no value is ever recorded here. Three secrets are
configured on the repository; `GITHUB_TOKEN` is provided automatically and
needs no setup.

| Secret | Purpose | Where configured |
|---|---|---|
| `GITHUB_TOKEN` | Provided automatically by GitHub Actions. Used by the `release` job to create the shared `vX.Y.Z` tag and publish or update the GitHub Release, by the `docs` job to push the docs-cut commit to `docs-versions`, and by the `next-pointer`/`develop-pointer` jobs to force-move their rolling `channel-next`/`channel-develop` tags and recreate the matching prerelease Release. Its actual scope is `release.yml`'s own `permissions:` block. | Nothing to configure; review the `permissions:` block in `.github/workflows/release.yml`. |
| `DOCKERHUB_USERNAME` | The Docker Hub account the `docker` job logs in as, to push and re-tag images. | Repository Settings → Secrets and variables → Actions. |
| `DOCKERHUB_TOKEN` | Docker Hub access token the `docker` job logs in with, to push and re-tag images. | Repository Settings → Secrets and variables → Actions. |
| `FIREBASE_SERVICE_ACCOUNT_ROUTERLY_DOCS` | Service-account JSON the `docs-deploy` job uses to deploy the documentation site to Firebase Hosting, router `routerly-docs`, channel `live`. | Repository Settings → Secrets and variables → Actions. |

## When a step fails

One row per job in `.github/workflows/release.yml`, plus the two other
workflows a release run can depend on.

| Failure | What is visible | What it leaves behind | What to do |
|---|---|---|---|
| Red `gate` job | `ci.yml` fails as a called workflow | Nothing downstream runs: no tag, no release, no image, no docs cut | Fix the CI failure and dispatch the run again. |
| `release` job refuses the version | The `Decide channel and action` step is red with one line (`must be greater than the latest release …` or `not an ancestor`) | No tag, no release, nothing downstream runs | Dispatch again with a higher version, or merge the branch that published the tag first. |
| `release` job fails for another reason | The `release` job is red | Possibly nothing, or a created tag/Release if `gh release create` ran | Read the step log. If the `vX.Y.Z` release exists but incomplete, delete it and its tag (`gh release delete vX.Y.Z --cleanup-tag`) and dispatch again. |
| `docker` job fails | The `docker` job is red | The git tag and GitHub Release already exist, since `release` already succeeded; no image was pushed or re-tagged | Re-run the failed job, or use **Docker Rebuild** afterward to push the missing tag. |
| `docs` job fails (only runs for a `current`-channel release) | The `docs` job is red | The release itself exists, but no documentation version was cut; `docs-deploy` is skipped since it needs `[release, docs]` | Cut the version locally following [Cutting a documentation version](#cutting-a-documentation-version), then re-run the `docs` and `docs-deploy` jobs. |
| `docs-deploy` job fails | The `docs-deploy` job is red | The version was cut and pushed to `docs-versions`; the live site still serves the previous build | Re-run the `docs-deploy` job. |
| `next-pointer` job fails (only runs for a `next`-channel release) | The `next-pointer` job is red | The release itself exists on `next`; the rolling `channel-next` git tag was not moved and its prerelease GitHub Release was not recreated | Re-run the `next-pointer` job. |
| `develop-pointer` job fails (only runs for a `develop`-channel release) | The `develop-pointer` job is red | The release itself exists on `develop`; the rolling `channel-develop` git tag was not moved and its prerelease GitHub Release was not recreated | Re-run the `develop-pointer` job. |

## Keeping module manifests in sync

The `release` job runs `npm version <version> --workspaces
--include-workspace-root --no-git-tag-version --ignore-scripts`, then
`node scripts/sync-module-versions.mjs`. Nothing extra to run: the moment
the job bumps every `package.json` to the typed version, this
second step rewrites every module manifest's `version` field and every
`^X.Y.Z` `dependsOn` range under `packages/service/src` to match it. It is
unconditional, not differential: it overwrites every matching literal with
the new canonical version, whatever it was before, and a tree that is
already in sync produces zero file changes.

The scope is fixed to `packages/service/src/**/*.ts`, excluding
`*.test.ts`.

To check whether the tree has drifted from the product version without
changing anything:

```bash
node scripts/sync-module-versions.mjs --check
```

A synced tree:

```
All module version literals in packages/service/src already match 0.4.0.
```
exits `0`.

A tree with a stale literal reports every occurrence, one line each, and
exits `1`:

```
packages/service/src/modules/catalog/index.ts:13: expected 0.4.0, found 0.3.9
```

If `--check` reports drift outside of a release (for example, a manifest
edited by hand with the wrong version), run `node
scripts/sync-module-versions.mjs` without `--check` to rewrite it in
place, or just let the next `npm run version` fix it: either way, never
edit the version literal by hand to make `--check` pass, since the next
release rewrites it again regardless.

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
3. Installs `website/`'s dependencies if `website/node_modules` is
   missing (`npm ci --prefix website`).
4. Runs the Docusaurus versioning CLI (`docusaurus docs:version <X.Y.Z>`),
   which:
   - copies `docs/` into `website/versioned_docs/version-<X.Y.Z>/`
   - copies `website/sidebars.ts` into
     `website/versioned_sidebars/version-<X.Y.Z>-sidebars.json`
   - prepends `<X.Y.Z>` to `website/versions.json`
5. Copies `docs/assets/` into the new versioned snapshot, since the
   Docusaurus versioning CLI only copies markdown pages.

`website/docusaurus.config.ts` sets no `lastVersion`: with it unset,
Docusaurus serves whichever entry is first in `website/versions.json` as
the default, un-prefixed version — and step 4 always prepends the new
version there, so the site's default automatically becomes what was just
cut. The always-current in-progress content in `docs/` is untouched and
stays reachable as `next`.

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

Exit code `0`. `website/docusaurus.config.ts` is not touched: nothing
in it names a specific version, so there is nothing to rewrite.

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
| Dependency install fails | `Failed to install website dependencies (npm ci --prefix website).` | Only shown when `website/node_modules` is missing. Run `npm ci --prefix website` yourself and inspect its output; the underlying npm error prints above this line. |
| Docusaurus CLI itself fails | `Docusaurus CLI failed to cut version <X.Y.Z>.` | The Docusaurus CLI's own output prints above this line; the version was not added to `website/versions.json`. |

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

The workflow validates the version before doing anything else, so no checkout
of Docker Hub credentials or build step runs on a bad input. Given a
version that is not `vX.Y.Z` or `X.Y.Z` (`latest`, `0.2`, `1.4.0.0`), it
fails the run with:

```
::error::Invalid version 'latest'. Accepted shapes are vX.Y.Z or X.Y.Z
```

and pushes nothing. There is no partial state to clean up: the tag decision
and the build both happen after this check passes.

## Site `install.sh` and the `Latest` flag

`https://www.routerly.ai/install.sh` redirects to
`releases/latest/download/install.sh`, i.e. the script attached to the release
flagged **Latest**. Every 0.3+ release is a GitHub pre-release, so that flag is
only moved by the `addChannelCmd` promotion (`gh release edit <tag> --latest`).
Until a release carrying the current `scripts/install.sh` is promoted, the site
serves the older script attached to the previously flagged release.
