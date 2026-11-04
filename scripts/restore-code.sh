#!/usr/bin/env bash
# Restore a backup made by backup-code.sh into an EMPTY folder. Never overwrites. ROUT-603.
# Usage: restore-code.sh <archive.tgz> <empty-dest-dir>
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <archive.tgz> <dest-dir>" >&2; exit 2; }
[ -f "$1" ] || { echo "archive not found: $1" >&2; exit 1; }
mkdir -p "$2"
[ -z "$(ls -A "$2")" ] || { echo "refusing: $2 is not empty" >&2; exit 1; }
tar xzf "$1" -C "$2"
echo "restored into $2 (code/, worktrees/); run 'git -C $2/code worktree repair' after moving it back to /opt/routerly"
