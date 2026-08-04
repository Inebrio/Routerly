# Releasing Routerly

Maintainer-facing release procedure. This is not user documentation: it
describes the steps a Routerly maintainer runs to cut a release, not
anything a self-hosted operator needs.

This file grows as more of the release procedure is automated. Today it
covers one step: cutting a new documentation version.

---

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
