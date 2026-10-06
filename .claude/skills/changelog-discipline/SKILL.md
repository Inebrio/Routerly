---
name: changelog-discipline
description: Routerly's CHANGELOG.md rules — entry format, who writes it per tier, promotion from Unreleased to a version, and archive rotation. Use whenever shipping a feature or fix, or when Unreleased needs to be cut to a version.
---

# Changelog discipline

`CHANGELOG.md` is tracked in the repo, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Every feature or bug fix adds its entry to the `## [Unreleased]` section at the top **as part of shipping the change** — same gate as documentation (see Quality bar in CLAUDE.md). Never reconstruct a version's changelog after the fact from git history; that is expensive and was already needed once (see `.claude/specs/` retrospectives around the 0.4.0 release-channels cut).

- Tier 0: whoever makes the fix adds the line.
- Tier 1/2: **docs-writer** adds it at the feature-level user-check gate, alongside the rest of the documentation it writes.
- Format matches the existing versioned entries: bold capability name + 1-3 sentences for features, one bullet per fix, a dedicated line for anything that changes the wire format, the CLI surface, or the management API contract.

**Promotion is not automatic.** `release.yml` is fully push-triggered with no human step, and it does not commit back to `main`/`develop` (deliberate, see `docs/contributing/releasing.md`'s "unstamped tag" note) — so nothing currently renames `## [Unreleased]` to a dated version heading. Until that gap is closed, whoever notices `[Unreleased]` has grown past what a release just shipped renames it by hand: `## [Unreleased]` → `## [X.Y.Z] — DATE`, fresh empty `## [Unreleased]` scaffold above it. Closing this properly means teaching `release.config.mjs` to commit `CHANGELOG.md` back to the branch (`@semantic-release/git`) — ask before adding that, it changes the release tag's git semantics.

**Rotation.** Once `CHANGELOG.md` holds more than 6 released versions, move the oldest ones verbatim into `CHANGELOG-archive.md` and leave a one-line pointer (`See CHANGELOG-archive.md for versions before X.Y.0.`) in their place — keeps the live file scannable without losing history.
