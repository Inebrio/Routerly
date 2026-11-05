#!/usr/bin/env sh
# Secret scan with gitleaks. Findings are always redacted: the secret is never printed.
#   secret-scan.sh staged            staged changes (pre-commit)
#   secret-scan.sh range <git-range> commits in a range (pre-push, CI)
# Locally a missing gitleaks only warns; CI installs it and is the mandatory gate.
set -e
if ! command -v gitleaks >/dev/null 2>&1; then
  if [ -n "$CI" ]; then echo "secret-scan: gitleaks not found in CI" >&2; exit 1; fi
  echo "secret-scan: gitleaks not installed, local check skipped (https://github.com/gitleaks/gitleaks#installing). CI still enforces it." >&2
  exit 0
fi
case "$1" in
  staged) exec gitleaks protect --staged --redact --no-banner --exit-code 1 ;;
  range)  exec gitleaks git --redact --no-banner --exit-code 1 --log-opts="$2" . ;;
  *) echo "usage: secret-scan.sh staged | range <git-range>" >&2; exit 2 ;;
esac
