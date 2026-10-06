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

There is no separate step to declare a version bump or a changelog entry.
The commit message is the whole contribution protocol: the next version
number and the release notes are both computed from the commit history at
release time, nothing is declared a second time anywhere.

Your commit's type must be one of the eleven `commitlint.config.js` allows:
`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`. Three of those drive the version:

- **`fix`** — a bug fix. Bumps the **patch** version.
- **`feat`** — a new feature, flag, endpoint or option. Bumps the **minor**
  version.
- A `!` after the type/scope (`feat!:`, `fix!:`) or a `BREAKING CHANGE:`
  footer in the commit body — a breaking change to the wire format, the
  CLI, the API or the configuration shape. Bumps the **major** version,
  regardless of the type it is attached to.

Every other type (`docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`) triggers no version bump on its own.

The same type also decides where your change shows up in the GitHub
release notes: `feat` under **Features**, `fix` under **Bug Fixes**, `perf`
under **Performance**, `docs` under **Documentation**, `refactor` under
**Refactor**. `chore`, `ci`, `build`, `test`, `style` and `revert` produce
no heading and no bullet; they exist for internal housekeeping and stay out
of what a reader sees changed.

`commitlint` enforces the type against that list and requires a lower-case
subject, on every commit via a Husky hook. It does **not** enforce the `!`
or `BREAKING CHANGE:` marker: nothing stops a commit that changes the wire
format from going out as a plain `feat` or `fix` and shipping as a minor or
patch bump. Marking a breaking change correctly is on the author, not on
tooling.

## Reference the issue you're closing

If a commit resolves a GitHub issue, say so in the body: `Closes #NNN`,
`Fixes #NNN`, or `Resolves #NNN`. `develop` is this repository's default
branch, so a commit using that syntax auto-closes the issue the moment it
lands there — no separate close step. `@semantic-release/github` also
auto-labels and comments on every issue/PR referenced by `#NNN` (closing
keyword or not) once the containing commit ships, with the release version
and a `released on @<channel>` label — this already runs, nothing to
configure. A commit that fixes something without a tracked issue needs
nothing extra.

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
| `main` | `current` (semantic-release's own name for it is `latest` — see below) | The currently shipped, stable release. | `ci.yml`, manually via `release.yml` (see [Triggering a release](#triggering-a-release)). |
| `next` | `next` | Validated pre-release line, promoted from `develop` once it has been reviewed. | `ci.yml`, manually via `release.yml`. |
| `develop` | `develop` | Bleeding-edge, unreviewed release line. Every merge to `develop` is a candidate; nothing between here and the commit history gates it. | `ci.yml`, manually via `release.yml`. |

The order in `release.config.mjs` is load-bearing, not decoration:

```
branches: ['main', { name: 'next', channel: 'next' }, { name: 'develop', channel: 'develop' }],
```

`main` being listed first is what makes its releases the stable, `latest`
ones; `next` and `develop` are each explicit about their own channel. Whether
a release is a prerelease, which prerelease line it belongs to, or the
stable `latest` one, is derived by semantic-release from this order —
nothing in this repository computes it. Reordering the array would silently
swap which branch is the stable one, or which of `next`/`develop` is allowed
to publish the higher version.

All three branches share **one tag namespace**: every release, on any of
them, gets a single `vX.Y.Z` git tag. There is no second, channel-prefixed
tag scheme — a version tagged `v1.5.3` is the same object whether it was
first published from `develop` or later promoted onto `next` or `main`.

**Migration note.** No `v0.4.0` starting tag was placed for this migration.
The last reachable tag going into it was `v0.2.0`, and the first version
semantic-release actually computed on `main` under this pipeline was
**`0.3.0`** — not `0.4.0` and not `1.0.0`. This is a real, observed result
from RC-1's dry run, not a hypothetical.

**Channel names.** The CLI, the config, the management API and the
installers accept exactly four values: `latest`, `current`, `next`,
`develop`, or a version tag such as `v0.4.0`. There are no aliases: every
value is validated and persisted verbatim.

:::warning Breaking change
`stable` and `develop` used to be accepted as deprecated aliases for
`current` and `next`. Both are retired: `stable` is now rejected outright
(400 from the management API, non-zero exit from the CLI and installers),
and `develop` is now a real channel in its own right — the bleeding-edge
line — not an alias for `next`. An instance that had `"develop"` persisted
under the old meaning now tracks the bleeding-edge line instead of `next`
the next time it checks for updates.
:::

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

The workflow takes no inputs beyond the ref itself — there is nothing to
fill in on the dispatch form. The branch you pick is also what
`scripts/ci-release-output.mjs` reads back to decide the channel; it accepts
exactly `main`, `next` or `develop` and fails loudly on anything else.

## What runs automatically

One row per job in `.github/workflows/release.yml`, once a maintainer
dispatches a run (see above).

| Job | Runs when | What it produces |
|---|---|---|
| `gate` | Every dispatched run | Runs the full `ci.yml` suite as a prerequisite. Nothing downstream runs if it fails. |
| `release` | `gate` passed | `npx semantic-release`. Computes the next version from the commit history, creates the shared `vX.Y.Z` tag, and publishes (or updates) the GitHub Release. If there is nothing to release, it exits cleanly with `released=false` and nothing downstream runs. |
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
tag beyond the one semantic-release already created on the branch.

## Promotion and back-merge

There is no separate "promote" workflow. Promotion is a two-hop chain of
ordinary pull requests: `develop` → `next`, then `next` → `main`. Each hop
is merged by hand; the pipeline only acts once a maintainer dispatches
`release.yml` against the branch that just received the merge (see
[Triggering a release](#triggering-a-release)).

**Promotion, not recomputation.** semantic-release computes a version from
the commit history, not from which branch a dispatch targets. `develop`, on
channel `develop`, has typically already published its own `vX.Y.Z` release
before the merge into `next` happens. Merging it into `next` does not put
in front of `next` any commits that were not already accounted for — the
same computation runs again and produces the same number. What actually
happens is that the release already published from `develop` is
republished from `next`: it takes over the `next` channel tag and
prerelease. The same pattern repeats one hop later, when `next` is merged
into `main`: the release already validated on `next` is republished from
`main`, loses its prerelease flag, and takes over the `latest` channel tag.
At neither hop is a new tag created or a second release object made; the
existing one is mutated in place.

**Worked example.** `main` is currently serving `1.4.1`, `next` has already
published `1.5.0`, and `develop` has already published `1.5.3`. A
maintainer merges `develop` into `next` and dispatches a release on `next`:
`next` now serves **1.5.3** (it still has a `.5.3`-or-lower range available,
see [EINVALIDNEXTVERSION](#einvalidnextversion)). The maintainer then merges
`next` into `main` and dispatches a release on `main`: `main` serves
**1.5.3** too — no new tag, no second release object; the existing `1.5.3`
release flips from prerelease to stable and becomes `latest`.

### The back-merge

The direction above only carries work forward, one hop at a time. It does
not cover a fix landing directly on a branch out of order — most commonly
a hotfix committed straight to `main`, outside the normal
`develop` → `next` → `main` chain. After that happens, a maintainer must
open and merge the fix backward by hand, covering **both** gaps it
creates: `main` → `next`, then `next` → `develop`. Nothing in the pipeline
automates either hop, and nothing detects a missed one.

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
| `release` job fails on `EINVALIDNEXTVERSION` | See [EINVALIDNEXTVERSION](#einvalidnextversion) below | No tag, no release, nothing to clean up; the branch is unchanged | See the recoveries below. |
| `release` job fails for another reason | The `release` job is red; `semantic-release.log` is available in the run | No tag, no release, nothing downstream runs | Read `semantic-release.log` for the specific cause, fix it, and dispatch the run again. |
| `docker` job fails | The `docker` job is red | The git tag and GitHub Release already exist, since `release` already succeeded; no image was pushed or re-tagged | Re-run the failed job, or use **Docker Rebuild** afterward to push the missing tag. |
| `docs` job fails (only runs for a `current`-channel release) | The `docs` job is red | The release itself exists, but no documentation version was cut; `docs-deploy` is skipped since it needs `[release, docs]` | Cut the version locally following [Cutting a documentation version](#cutting-a-documentation-version), then re-run the `docs` and `docs-deploy` jobs. |
| `docs-deploy` job fails | The `docs-deploy` job is red | The version was cut and pushed to `docs-versions`; the live site still serves the previous build | Re-run the `docs-deploy` job. |
| `next-pointer` job fails (only runs for a `next`-channel release) | The `next-pointer` job is red | The release itself exists on `next`; the rolling `channel-next` git tag was not moved and its prerelease GitHub Release was not recreated | Re-run the `next-pointer` job. |
| `develop-pointer` job fails (only runs for a `develop`-channel release) | The `develop-pointer` job is red | The release itself exists on `develop`; the rolling `channel-develop` git tag was not moved and its prerelease GitHub Release was not recreated | Re-run the `develop-pointer` job. |

### EINVALIDNEXTVERSION

**Trigger.** A commit is released directly from `main` or `next`, out of
the normal `develop` → `next` → `main` promotion order, and the version it
computes would exceed what the next branch down the chain has already
published.

**Cause.** `release.config.mjs`'s `branches` array orders `main`, then
`next`, then `develop`. semantic-release enforces that each branch's
computed version stays below the next branch's own valid range: a branch
earlier in the order is not allowed to publish a version that outruns a
branch later in the order. There are therefore two boundaries where this
can fire: `main` outrunning `next`, and `next` outrunning `develop`. Either
way the `release` job fails before creating anything.

**Worked example, `main`/`next` boundary.** `main` serving `1.4.0`, `next`
having already published `1.5.3`: a `fix` dispatched on `main` (→ `1.4.1`)
is fine, and even a first `feat` (→ `1.5.0`) is fine, because both stay
below `next`'s `1.5.3`. A second `feat` on `main` (→ `1.6.0`) or a
`BREAKING CHANGE` (→ `2.0.0`) fails the release run, because both exceed
`1.5.3`.

**Worked example, `next`/`develop` boundary.** Same mechanism, one hop
further down the chain. `next` serving `1.5.0`, `develop` having already
published `1.6.2`: a `fix` dispatched on `next` (→ `1.5.1`) is fine; a
`feat` on `next` that would compute `1.7.0` is not, because it exceeds
`develop`'s `1.6.2`. The fix here is the same shape as the recoveries
below, one branch to the right: merge `develop` into `next` first, or land
the change on `develop` and promote it from there.

This is the mechanism RC-1's validation actually observed, not vendor
documentation alone: a scratch repository with `main`'s valid next-version
range at `>=1.1.0 <1.2.0` and `develop` already at `1.1.0`, a `feat` commit
on `main` computing `1.2.0` was rejected with `EINVALIDNEXTVERSION`, exit
code `1`, and a structured error naming the responsible commit, the valid
range, and semantic-release's own suggested recovery: merge, cherry-pick,
revert or reset — "a valid branch could be `develop`". See
`.claude/specs/release-channels/03-validation/RC-1.md` for the captured
error. The numbers in both worked examples above are illustrations built on
that same mechanism, not a restatement of RC-1's own numbers.

**What the failed run leaves behind.** No tag, no release, nothing to
clean up. The commit is still on its branch, unchanged; only the release
run failed.

**Recoveries**, any one of the three, applied to whichever boundary fired:

1. Merge the branch one hop down the chain (`next` for a `main` failure,
   `develop` for a `next` failure) into the failing branch first, so it
   adopts the lower branch's number, then dispatch the release again. This
   is an ordinary [promotion](#promotion-and-back-merge).
2. Land the change on the branch one hop down the chain instead, and
   promote it from there once it has published.
3. Dispatch the equivalent release on the branch one hop down the chain
   first, so it stays ahead of the failing branch, then dispatch the same
   change on the original branch.

## Keeping module manifests in sync

`release.config.mjs`'s `prepareCmd` runs `npm version ${nextRelease.version}
--workspaces --include-workspace-root --no-git-tag-version
--ignore-scripts`, then, automatically, `node
scripts/sync-module-versions.mjs`. Nothing extra to run: the moment
semantic-release bumps every `package.json` to the computed version, this
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
