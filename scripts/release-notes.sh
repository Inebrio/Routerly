#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# Routerly — Release notes generator
#
# Renders the GitHub Release body from a conventional-commit history, for an
# explicit commit range. Grouping and skip rules live in cliff.toml at the
# repository root. This script never touches the per-package CHANGELOG.md
# files — those are written by Changesets (release-version.yml); git-cliff
# only ever writes the GitHub Release body.
#
# Usage:
#   scripts/release-notes.sh <from-ref> <to-ref> [--tag vX.Y.Z]
#
# The rendered notes are printed to stdout, nothing else. Diagnostics go to
# stderr. Exits 0 on success, including an empty range (a well-formed, empty
# document, never an error). Exits 1 with one line on stderr for a missing or
# unresolvable ref, or the wrong number of arguments.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Pinned to an exact version, not a range or "latest": AC2 requires two
# renders of the same commit range to be byte-identical, and a floating
# git-cliff version could change grouping or output between the two runs.
GIT_CLIFF_VERSION="2.13.1"

usage() {
  echo "Usage: release-notes.sh <from-ref> <to-ref> [--tag vX.Y.Z]" >&2
}

if [[ $# -lt 2 || $# -gt 4 ]]; then
  usage
  exit 1
fi

FROM_REF="$1"
TO_REF="$2"
shift 2

TAG=""
if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--tag" && -n "${2:-}" ]]; then
    TAG="$2"
    shift 2
  else
    usage
    exit 1
  fi
fi

if [[ $# -ne 0 ]]; then
  usage
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! git -C "$REPO_ROOT" rev-parse --verify --quiet "${FROM_REF}^{commit}" >/dev/null; then
  echo "release-notes: unresolvable ref '${FROM_REF}'" >&2
  exit 1
fi

if ! git -C "$REPO_ROOT" rev-parse --verify --quiet "${TO_REF}^{commit}" >/dev/null; then
  echo "release-notes: unresolvable ref '${TO_REF}'" >&2
  exit 1
fi

if command -v git-cliff >/dev/null 2>&1; then
  CLIFF=(git-cliff)
elif command -v npx >/dev/null 2>&1; then
  CLIFF=(npx --yes "git-cliff@${GIT_CLIFF_VERSION}")
else
  echo "release-notes: git-cliff is not installed and npx is not on PATH to fetch it. Install git-cliff ${GIT_CLIFF_VERSION}, or make node available." >&2
  exit 1
fi

CLIFF_ARGS=(--config "${REPO_ROOT}/cliff.toml" "${FROM_REF}..${TO_REF}")
# Restrict which tags git-cliff treats as release boundaries within the
# range to the project's own version tags. Without this, any other
# reachable tag (this repository has a stray "develop" tag) is picked up as
# a mid-range boundary and splits one range into multiple "## <tag>"
# sections, which makes rendering depend on which tags happen to exist —
# exactly what the story's out-of-scope note forbids.
CLIFF_ARGS+=(--tag-pattern '^v[0-9]+\.[0-9]+\.[0-9]+$')
if [[ -n "$TAG" ]]; then
  CLIFF_ARGS+=(--tag "$TAG")
fi

# Run from the repository root, not via --repository/--workdir: this is a
# git worktree, where .git is a file (gitdir pointer) rather than a
# directory, and git-cliff's own repository-path resolution does not follow
# it — it only works through cwd-based discovery.
cd "$REPO_ROOT"

# Capture stderr rather than letting it through. When git-cliff is reached via
# `npx --yes` and the machine is offline, npm fails with a multi-line stack
# trace, and this script's contract is one line. The captured text is not
# thrown away: its first line is appended as the cause, so a genuine git-cliff
# error (a malformed cliff.toml, say) still says what it was.
CLIFF_ERR="$(mktemp)"
trap 'rm -f "$CLIFF_ERR"' EXIT
if ! "${CLIFF[@]}" "${CLIFF_ARGS[@]}" 2>"$CLIFF_ERR"; then
  CAUSE="$(grep -v '^[[:space:]]*$' "$CLIFF_ERR" | head -1)"
  echo "release-notes: git-cliff failed to render ${FROM_REF}..${TO_REF}${CAUSE:+ — ${CAUSE}}" >&2
  exit 1
fi
