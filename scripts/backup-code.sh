#!/usr/bin/env bash
# Local backup of the working-code folders (outside the repository). ROUT-603.
# Saves the `code` folder whole, and from every worktree only what git cannot rebuild:
# modified and untracked files plus the .git pointer (committed content lives in code/.git).
# Usage: backup-code.sh [dest-dir]   env: CODE_ROOT (default /opt/routerly), KEEP (default 8)
set -euo pipefail
root="${CODE_ROOT:-/opt/routerly}"
dest="${1:-$root/backup/code}"
keep="${KEEP:-8}"
mkdir -p "$dest"
out="$dest/code-$(date -u +%Y%m%dT%H%M%SZ).tgz"
list="$(mktemp)"; trap 'rm -f "$list"' EXIT
for wt in "$root"/worktrees/*/; do
  wt="${wt%/}"; [ -e "$wt/.git" ] || continue
  echo "worktrees/$(basename "$wt")/.git" >> "$list"
  git -C "$wt" ls-files -m -o --exclude-standard -z 2>/dev/null | xargs -0 -r -n1 printf '%s\n' | sed "s#^#worktrees/$(basename "$wt")/#" >> "$list" || true
done
# exit 1 = a file changed while being read (live folders): the archive is still valid
tar czf "$out.part" --ignore-failed-read -C "$root" \
  --exclude=node_modules --exclude=dist --exclude='*.tsbuildinfo' --exclude=.playwright-mcp \
  --exclude=code/node_modules -T "$list" code || [ $? -eq 1 ]
mv "$out.part" "$out"
ls -1t "$dest"/code-*.tgz | tail -n +$((keep + 1)) | xargs -r rm -f
echo "$out"
