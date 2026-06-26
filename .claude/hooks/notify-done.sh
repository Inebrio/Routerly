#!/bin/bash
# Fires when Claude finishes a turn (Stop event)
osascript -e 'display notification "Claude finished" with title "Routerly" sound name "Glass"' 2>/dev/null || true
