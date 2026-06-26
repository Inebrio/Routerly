#!/bin/bash
# UserPromptSubmit hook — injects the verification mandate into every turn's context.
# stdout is added as a system-reminder by Claude Code.

cat <<'EOF'
VERIFICATION MANDATE (every turn):
- "VERIFIED DONE" = each layer the feature touches was RUN and observed, never just read.
- UI / dashboard feature → Chrome MCP screenshot, one per variant. Browser required for UI work ONLY.
- Service / API feature → curl vs localhost:3000, exact status + body. No browser needed.
- CLI feature → actual command, exact stdout/stderr + exit code. No browser needed.
- Always → npm test green + npm run typecheck clean.
- Missing the evidence for a touched layer → status is NOT VERIFIED.
EOF
