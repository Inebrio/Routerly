#!/bin/bash
# Stop hook — blocks if VERIFIED DONE claimed on a UI feature without browser screenshot evidence.
# Service-only / CLI-only claims pass on curl/command evidence (no browser required).
# Input: JSON on stdin. Output: JSON {"continue": bool, "reason": string}

INPUT=$(cat)

# Avoid infinite loop
STOP_HOOK_ACTIVE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stop_hook_active', False))" 2>/dev/null || echo "False")
if [ "$STOP_HOOK_ACTIVE" = "True" ]; then
  echo '{"continue": false}'
  exit 0
fi

# Extract last assistant message text
LAST_MSG=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
msgs = d.get('messages', [])
for m in reversed(msgs):
    if m.get('role') == 'assistant':
        content = m.get('content', '')
        if isinstance(content, list):
            text = ' '.join(c.get('text','') for c in content if isinstance(c, dict) and c.get('type')=='text')
        else:
            text = str(content)
        print(text)
        break
" 2>/dev/null || echo "")

# Only enforce when VERIFIED DONE is claimed
if ! echo "$LAST_MSG" | grep -q "VERIFIED DONE"; then
  echo '{"continue": false}'
  exit 0
fi

# Browser is required for UI work ONLY. If the claim is not about a dashboard/UI
# feature, curl/CLI evidence is sufficient — let it pass without a screenshot.
if ! echo "$LAST_MSG" | grep -qiE 'dashboard|\.tsx|component|page|render|theme|sidebar|browser|screenshot|UI\b'; then
  echo '{"continue": false}'
  exit 0
fi

# UI feature claimed — check a browser tool (computer/chrome MCP) was actually used
BROWSER_USED=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
msgs = d.get('messages', [])
for m in msgs:
    if m.get('role') == 'assistant':
        content = m.get('content', [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get('type') == 'tool_use':
                    name = block.get('name', '')
                    if 'computer' in name or 'chrome' in name.lower():
                        print('yes')
                        exit()
print('no')
" 2>/dev/null || echo "no")

if [ "$BROWSER_USED" = "no" ]; then
  echo '{"continue": true, "reason": "VERIFIED DONE claimed on a UI feature but no browser screenshot found. Use the verify skill: open Chrome MCP, navigate to the page, screenshot each variant. curl is NOT browser verification for UI work."}'
  exit 0
fi

echo '{"continue": false}'
