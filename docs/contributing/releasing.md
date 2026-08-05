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

Three branches carry release meaning; everything else is ordinary
development.

| Branch | What it means | What it runs |
|---|---|---|
| `main` | The currently shipped release. | `ci.yml` and `release.yml` on every push. |
| `develop` | The next release in progress. Nothing publishes automatically from a push here; publishing the `develop` channel is a manual dispatch (see [Promoting a release](#promoting-a-release)). | `ci.yml` only. |
| `release/**` | A candidate line: future and unstable. **Not every `release/**` branch reaches `main`.** A branch can be abandoned instead, which is what [aborting a release](#aborting-a-release) is for. | `ci.yml` and `release-version.yml` on every push; a *green* CI run additionally triggers `release-docker.yml`. |

The documentation site mirrors this with its own version labels, configured
in `website/docusaurus.config.ts`:

| Docs version | Label | What it tracks |
|---|---|---|
| `current` | "next (future)" | The live `docs/` tree on whatever branch is checked out. Content that has not necessarily shipped. |
| `0.3.0` | "0.3.0 (develop)" | The snapshot corresponding to the `develop` line. |
| `lastVersion` | no separate label, this is the default a visitor lands on | The currently shipped stable release, matching `main`. At the time of writing this is `0.2.0`. |

`lastVersion` is not a fact frozen in this page: it is rewritten by
`npm run docs:cut` every time a release is promoted (see
[Cutting a documentation version](#cutting-a-documentation-version)), so it
moves forward on every release. `website/versions.json` lists every cut
version as a bare `X.Y.Z`, newest first, independently of this page.

## What runs automatically

One row per trigger, ordered by the branch it fires on.

| Trigger | Workflow | What it produces |
|---|---|---|
| Push to `release/**` | `release-version.yml` | Fails fast if `.changeset/pre.json` exists (see [Prerelease mode is not used on this line](#prerelease-mode-is-not-used-on-this-line)). Otherwise opens or updates the Version PR, based on that same release branch. |
| Push to `main`, `develop` or `release/**`, and pull requests targeting them | `ci.yml` | `npm audit --audit-level=high`; build and typecheck of all four packages; the four workspace test suites with coverage; `npm ci --prefix website`; the release-tooling test suites via `npx vitest run`. A coverage summary is written to the run summary. |
| `ci.yml` completes successfully on `release/**` | `release-docker.yml` | A multi-arch (`linux/amd64`, `linux/arm64`) push of `inebrio/routerly:v<X.Y.Z>-rc.<CI run number>`, then a `release-docker` commit status on the head commit. The `-rc.N` number is the CI run number, not a changesets prerelease identifier, so it is not contiguous across failed and re-run CI attempts. |
| Push to `main` | `release.yml`, job `release` | If changesets are pending, opens or updates the Version PR and stops there. Otherwise it builds every package, renders `RELEASE_NOTES.md` from the git history, creates tag `v<X.Y.Z>`, and publishes the GitHub Release. This step is idempotent: if the tag already exists, it does nothing further. |
| `release` job promoted | `release.yml`, job `docker` | Multi-arch push of `inebrio/routerly:latest` and `inebrio/routerly:v<X.Y.Z>`. |
| `release` job promoted | `release.yml`, job `docs` | Runs `npm run docs:cut -- <X.Y.Z>` and commits the result to `main` as `chore(docs): cut documentation version <X.Y.Z>`. No-ops cleanly if the cut produces no diff. |
| `docs` job succeeded | `release.yml`, job `docs-deploy` | Builds `website/` and deploys it to Firebase Hosting (project `routerly-docs`, channel `live`). |
| `docker` job succeeded | `release.yml`, job `stable` | The stable-channel promotion, see below. |

`docs-deploy` and `stable` are reusable workflows called as jobs of
`release.yml` with `secrets: inherit`. That only propagates secrets to
them, not permissions: what each of those jobs is allowed to do is still
capped by `release.yml`'s own `permissions:` block.

## Promoting a release

There are two promotion paths, each a separate workflow, and neither runs
on a plain push.

**Stable.** `promote-stable.yml` runs automatically as the `stable` job of
`release.yml` once a release is built and its Docker image pushed, or on
demand via `workflow_dispatch` with a `version` input like `v0.1.5`. It
verifies the GitHub Release for that version exists, checks out the tag,
force-pushes the `stable` git tag, recreates the `stable` GitHub Release,
then re-tags the already-built multi-arch image from
`inebrio/routerly:v<X.Y.Z>` to `inebrio/routerly:stable` — a re-tag via
`docker buildx imagetools create`, not a rebuild.

It refuses explicitly, before moving any tag, if
`inebrio/routerly:v<X.Y.Z>` is not present in the registry. Versions at or
before `0.3.0` only ever got the bare `X.Y.Z` image tag, never the
`v`-prefixed one, so they cannot be promoted through this workflow as it
stands; a version needs to have shipped through the current pipeline (or
been rebuilt with the correct tag through **Docker Rebuild**) before it can
become stable.

**Develop.** `promote-develop.yml` is `workflow_dispatch` only, with a
`branch` input defaulting to `develop`. It builds from that branch,
force-pushes the `develop` git tag, recreates the `develop` GitHub Release
as a prerelease titled `Routerly develop (<branch>@<short sha>)`, and
pushes `inebrio/routerly:develop` plus `inebrio/routerly:v<X.Y.Z>`. Nothing
promotes the develop channel automatically; a maintainer always dispatches
it.

## Aborting a release

A `release/**` branch does not have to reach `main`. To abandon one, run
the **Release Abort** workflow (`release-abort.yml`) from the Actions tab,
`workflow_dispatch` only, with a `version` input accepting either `v0.5.0`
or `0.5.0`. It runs `node scripts/release-abort.mjs --version "$INPUT_VERSION"`.

What it does:

- Deletes only the Docker Hub tags matching `^v<X.Y.Z>-rc\.[0-9]+$` in
  `inebrio/routerly` — the prerelease images `release-docker.yml` published
  from that branch's CI runs.
- Refuses, with exit code `2`, and deletes nothing, if the git tag
  `v<X.Y.Z>` already exists — that means the version was already promoted,
  and this workflow is not the tool to undo a promotion. This check runs
  before any network call to the registry.
- `latest`, `develop` and `stable` are never touched; their digests are
  printed before and after the run so that is verifiable from the log.
- Exit codes: `0` for success, including "nothing to remove"; `1` for an
  operational failure (bad arguments, missing `DOCKERHUB_USERNAME` or
  `DOCKERHUB_TOKEN`, a network or auth error); `2` for the promoted-version
  refusal above.
- `--dry-run` prints the exact `DELETE` requests it would issue, with the
  token redacted, without deleting anything. `--tags-file <path>` reads a
  JSON array of tag names instead of querying the registry, for offline
  preview.

**What it leaves behind.** Aborting is registry cleanup only, not branch
teardown. The release branch itself, its commits, its git tags, its
Version PR and any GitHub Release it produced are all left untouched.
Deleting the branch and closing the Version PR are manual steps a
maintainer still has to do after the workflow runs.

## Credentials the pipeline needs

Names and purposes only; no value is ever recorded here.

| Secret | Purpose | Where configured |
|---|---|---|
| `GITHUB_TOKEN` | Provided automatically by GitHub Actions. Used to open and update the Version PR, push tags, publish and delete GitHub Releases, push the docs-cut commit to `main`, and post the `release-docker` commit status. Its actual scope is each workflow's own `permissions:` block. | Nothing to configure; review the `permissions:` block of the workflow in question. |
| `DOCKERHUB_USERNAME` | The Docker Hub account used to push and delete image tags. | Repository Settings → Secrets and variables → Actions. |
| `DOCKERHUB_TOKEN` | Docker Hub access token. Needs Read, Write and Delete: delete is required because `release-abort.mjs` removes prerelease tags. | Repository Settings → Secrets and variables → Actions. |
| `FIREBASE_SERVICE_ACCOUNT_ROUTERLY_DOCS` | Service-account JSON used to deploy the documentation site to Firebase Hosting, project `routerly-docs`, channel `live`. | Repository Settings → Secrets and variables → Actions. |

## When a step fails

| Failure | What is visible | What it leaves behind | What to do |
|---|---|---|---|
| Red `ci.yml` on a `release/**` branch | The CI run fails; no `release-docker` commit status appears | No prerelease image was built, since `release-docker.yml` only fires on a successful CI run | Fix the failure and push again. The next green CI produces a new `-rc.<run number>`, so `-rc` numbers are not contiguous. |
| `.changeset/pre.json` present on a release branch | `release-version.yml` fails with the guard's error message | No Version PR is opened or updated | Run `npx changeset pre exit` on that branch and push again (see [Prerelease mode is not used on this line](#prerelease-mode-is-not-used-on-this-line)). |
| Docker push fails in `release.yml` | The `docker` job is red | The git tag and GitHub Release already exist, since the `release` job runs first; the `stable` job is skipped because it needs `[release, docker]`; `latest` and `v<X.Y.Z>` were never pushed | Re-run the failed job, or use **Docker Rebuild** to push the missing tags, then dispatch **Promote Stable Channel** manually. |
| `npm run docs:cut` fails in `release.yml` | The `docs` job is red | The release itself exists, but no documentation version was cut; `docs-deploy` is skipped since it needs `[release, docs]` | Cut the version locally following [Cutting a documentation version](#cutting-a-documentation-version), commit it to `main`, then dispatch **Deploy Docs** manually. |
| Firebase deploy fails | The `docs-deploy` job is red | The version was cut and committed; the site is still serving the previous build | Dispatch **Deploy Docs** again. |
| `promote-stable` cannot find the source image | An explicit `::error::` before any tag moves | `stable` is unchanged | Push the version image first (**Docker Rebuild**), then re-dispatch **Promote Stable Channel**. |
| `release-abort` refuses (exit `2`) | The run fails with the refusal message | Nothing is deleted | This is intended behaviour: the version was already promoted and is not abortable through this workflow. |

## Keeping module manifests in sync

`npm run version` runs `changeset version` and then, automatically,
`node scripts/sync-module-versions.mjs`. Nothing extra to run: the moment
the Version PR bumps `packages/service/package.json` to the new number,
this second step rewrites every module manifest's `version` field and
every `^X.Y.Z` `dependsOn` range under `packages/service/src` to match it.
It is unconditional, not differential: it overwrites every matching
literal with the new canonical version, whatever it was before, and a
tree that is already in sync produces zero file changes.

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

## Generating release notes

The body of the GitHub Release is generated from the git history, not
written by hand. `scripts/release-notes.sh` renders it with
[git-cliff](https://git-cliff.org), using the grouping rules in
`cliff.toml` at the repository root, and the release workflow
(`.github/workflows/release.yml`) calls it and puts the result straight
into the release body. This is the GitHub Release only: it never touches
the per-package `CHANGELOG.md` files, which stay Changesets' job (see
above).

### What ends up under which heading

The commit's type, the same one commitlint enforces
(`commitlint.config.js`), decides where it lands:

| Commit type | Heading |
|---|---|
| `feat` | Features |
| `fix` | Bug Fixes |
| `perf` | Performance |
| `docs` | Documentation |
| `refactor` | Refactor |
| `chore`, `ci`, `build`, `test`, `style` | not shown |
| a merge commit (`Merge ...`) | not shown |
| anything else, including a subject that is not a conventional commit at all | Other Changes |

Nothing is silently dropped except merge commits and the five types the
table marks "not shown": those exist for internal housekeeping and say
nothing to someone reading what changed. A subject that does not follow
the conventional-commit form still appears in the notes, under "Other
Changes", so a change is never lost for having the wrong prefix; it is
just not sorted by type.

### Previewing locally

```bash
scripts/release-notes.sh <from-ref> <to-ref> [--tag vX.Y.Z]
```

The rendered notes go to stdout, nothing else; diagnostics go to stderr.
Run it from the repository root against two real refs, for example the
previous tag and `HEAD`:

```
$ scripts/release-notes.sh v0.1.5 v0.2.0
## v0.2.0

### Features

- Add time-based filtering and pagination to usage page
...

### Bug Fixes

- **auth:** Rotate refresh token on every use
...
```

`--tag vX.Y.Z` labels the heading with that version explicitly; without
it, git-cliff uses `<to-ref>` if it is itself a matching version tag. A
range with no commits still renders a well-formed, empty document instead
of failing:

```
$ scripts/release-notes.sh v0.2.0 v0.2.0
## Release Notes
```

Two renders of the same range are byte-identical: nothing in the output
depends on the wall clock or on which unrelated tags happen to exist in
the repository.

### Failures

A missing or unresolvable ref, or the wrong number of arguments, exits
`1` with one line on stderr:

```
$ scripts/release-notes.sh does-not-exist v0.2.0
release-notes: unresolvable ref 'does-not-exist'

$ scripts/release-notes.sh v0.2.0
Usage: release-notes.sh <from-ref> <to-ref> [--tag vX.Y.Z]
```

If git-cliff itself fails to render (a malformed `cliff.toml`, for
instance), the error is still one line on stderr with the underlying
cause appended, and exit code `1`. This is what the release workflow sees
if the step fails.

### Prerequisite

The script looks for `git-cliff` on `PATH` first. If it is not installed,
it falls back to `npx --yes git-cliff@2.13.1`, so a working `node`/`npx`
is enough to preview notes locally without installing anything. The
version is pinned, not a floating range, so a preview and the release
workflow's own run render the same output for the same range.

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

The workflow validates the version before doing anything else, so no checkout
of Docker Hub credentials or build step runs on a bad input. Given a
version that is not `vX.Y.Z` or `X.Y.Z` (`latest`, `0.2`, `1.4.0.0`), it
fails the run with:

```
::error::Invalid version 'latest'. Accepted shapes are vX.Y.Z or X.Y.Z
```

and pushes nothing. There is no partial state to clean up: the tag decision
and the build both happen after this check passes.
