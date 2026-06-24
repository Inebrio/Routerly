#!/bin/bash
# Routerly dev environment init — run at the start of every session
set -e

echo "=== Routerly init ==="

# Node version check
NODE_VERSION=$(node -v)
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node $NODE_VERSION — requires >= 20" >&2
  exit 1
fi
echo "Node $NODE_VERSION OK"

# Dependencies installed?
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Shared package built? (other packages depend on it)
if [ ! -d "packages/shared/dist" ]; then
  echo "Building shared package..."
  npm run build --workspace=packages/shared
fi

# Config directory exists?
ROUTERLY_HOME="${ROUTERLY_HOME:-$HOME/.routerly}"
if [ ! -d "$ROUTERLY_HOME" ]; then
  echo "WARNING: ROUTERLY_HOME not found at $ROUTERLY_HOME — run 'routerly' CLI to initialise"
fi

echo "=== Ready ==="
