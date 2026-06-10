#!/usr/bin/env bash
# Routerly 0.2.0 release script — run off-hours (before 09:00 or after 18:00, no weekends)
# Prerequisites: gh auth status && docker login (inebrio account)
set -euo pipefail

REPO="Inebrio/Routerly"
DOCKER_IMAGE="inebrio/routerly"
VERSION="0.2.0"
TAG="v${VERSION}"

echo "=== Routerly ${TAG} Release Script ==="

# Step 1: Commit
echo "→ Step 1: Commit"
git commit -m "fix(release): fix E2E tests, Docker JSON imports, add cost calculator tests

- vitest.config.ts: move loadEnv from vitest/config to vite (vitest 4.x)
- api.ts: add /api/system/info to JWT middleware whitelist (public endpoint)
- e2e.test.ts: update POST /api/system/update assertions 403 -> 401
- shared JSON imports: add with { type: 'json' } for Node 22+/25+ compat
- tsconfig.base.json: Node16 -> NodeNext (supports import attributes)
- .dockerignore: add **/*.tsbuildinfo (prevent stale incremental cache in Docker)
- CHANGELOG.md: add full 0.2.0 release notes
- cost/calculator.test.ts: 8 unit tests for calculateCost

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

# Step 2: Push develop
echo "→ Step 2: Push develop"
git push origin develop

# Step 3: PR develop -> main
echo "→ Step 3: PR develop -> main"
PR_BODY_FILE="$(mktemp)"
cat > "${PR_BODY_FILE}" << 'PRBODY'
## Routerly 0.2.0 — Release candidate

### New features
- Semantic response cache (embeddings-based)
- Semantic intent routing policy
- Anthropic Messages API with multi-provider fallback (Claude Desktop compatible)
- Conversation-aware routing memory store
- Per-request cost breakdown (input/output/cache tokens)
- New providers: DeepSeek, Groq, Together AI, Perplexity
- New Claude models: claude-fable-5, opus-4-8, opus-4-7
- Decoupled Routerly model ID from upstream API model name
- Built-in update checker (polls GitHub Releases every 24h)
- Dynamic update channels from GitHub Releases
- CLI: `routerly update check/channel/run`
- Dashboard: Software Update section, Help & Support page
- Opt-in anonymous telemetry
- New API: `/api/system/info` (public), `/api/system/update-check`, `/api/system/update`, `/api/system/releases`
- Dashboard UX: searchable policy editor, usage pagination, alphabetical models

### Bug fixes
- Fixed `/api/system/info` accidentally protected by JWT middleware
- Fixed Qwen3 thinking-only response in Ollama adapter
- Fixed `reasoning_effort` forwarded to non-o-series models
- Upgraded Fastify v5, Vite v6, Vitest v4, Commander v14, Zod v4, lucide-react
- Security hardening

### Release prep (this PR)
- vitest.config.ts: loadEnv moved to vite (vitest 4.x compat)
- tsconfig.base.json: Node16 -> NodeNext (import attributes support)
- shared JSON imports: with { type: 'json' } (Node 22+/25+ required)
- .dockerignore: added **/*.tsbuildinfo (Docker incremental build fix)
- CHANGELOG.md added
- cost/calculator.test.ts: 8 new unit tests

### Tests
93 passing (11 cli + 54 service + 28 E2E). Docker: build, health, setup, auth, models all verified.

### Breaking changes
None. OpenAI and Anthropic wire formats unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY

gh pr create \
  --repo "${REPO}" \
  --base main \
  --head develop \
  --title "release: Routerly 0.2.0" \
  --body-file "${PR_BODY_FILE}"
rm -f "${PR_BODY_FILE}"

echo ""
echo "→ Attendi che la PR sia approvata e mergiata in main, poi premi ENTER."
read -r -p "ENTER per continuare..."

# Step 4: Checkout main
echo "→ Step 4: Checkout main"
git checkout main
git pull origin main

# Step 5: Ricrea tag v0.2.0 su main HEAD
echo "→ Step 5: Ricrea tag ${TAG}"
git tag -d "${TAG}" 2>/dev/null || true
git push origin --delete "${TAG}" 2>/dev/null || true
git tag -a "${TAG}" -m "Routerly ${TAG}"
git push origin "${TAG}"

# Step 6: Aggiorna GitHub Release
echo "→ Step 6: Aggiorna GitHub Release"
NOTES_FILE="$(mktemp)"
awk '/^## \[0\.2\.0\]/{found=1} found && /^## \[0\.1\./{exit} found{print}' CHANGELOG.md > "${NOTES_FILE}"
gh release edit "${TAG}" \
  --repo "${REPO}" \
  --title "Routerly ${TAG}" \
  --notes-file "${NOTES_FILE}"
rm -f "${NOTES_FILE}"

# Step 7: Docker multiarch build e push
echo "→ Step 7: Docker build multiarch e push"
docker buildx create --use --name routerly-builder 2>/dev/null || docker buildx use routerly-builder
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "${DOCKER_IMAGE}:${VERSION}" \
  --tag "${DOCKER_IMAGE}:latest" \
  --push \
  .

echo ""
echo "=== ${TAG} rilasciato ==="
echo "  GitHub: https://github.com/${REPO}/releases/tag/${TAG}"
echo "  Docker: https://hub.docker.com/r/${DOCKER_IMAGE}/tags"
echo ""
echo "→ Verifica docs: la versione default Docusaurus deve puntare a 0.2.0"
