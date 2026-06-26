#!/bin/bash
# Fires on PreToolUse(Bash). Reads the tool input from stdin as JSON.
# Blocks destructive commands that should never run autonomously.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('command',''))" 2>/dev/null || echo "")

# Block force push to main/master
if echo "$COMMAND" | grep -qE 'git push.*(--force|-f).*(main|master)'; then
  echo "BLOCKED: force push to main/master is not allowed" >&2
  exit 1
fi

# Block rm -rf without explicit user path confirmation
# if echo "$COMMAND" | grep -qE 'rm\s+-rf\s+/'; then
#   echo "BLOCKED: rm -rf on absolute paths requires explicit user confirmation" >&2
#   exit 1
# fi

# Block git reset --hard without user confirmation
# if echo "$COMMAND" | grep -qE 'git\s+reset\s+--hard\s+HEAD~'; then
#   echo "BLOCKED: git reset --hard HEAD~ requires explicit user confirmation" >&2
#   exit 1
# fi

exit 0
