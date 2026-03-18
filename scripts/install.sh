#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# Routerly — Install script (Linux / macOS)
#
# Usage:
#   curl -fsSL https://your-domain.com/install.sh | bash
#   curl -fsSL https://your-domain.com/install.sh | bash -s -- --yes
#   curl -fsSL https://your-domain.com/install.sh | bash -s -- --scope=system
#
# Flags are forwarded to install.mjs.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Distribution config ───────────────────────────────────────────────────────
GITHUB_OWNER="routerly"
GITHUB_REPO="routerly"
REQUIRED_NODE_MAJOR=20

# ── Colors ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD="\033[1m"
  DIM="\033[2m"
  GREEN="\033[0;32m"
  YELLOW="\033[0;33m"
  RED="\033[0;31m"
  CYAN="\033[0;36m"
  RESET="\033[0m"
else
  BOLD="" DIM="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
info()    { echo -e "${CYAN}${BOLD}→${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}!${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}✗${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }

# ── Temp dir + cleanup ────────────────────────────────────────────────────────
TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

# ── Detect OS / arch ──────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *)      die "Unsupported OS: $OS. Use install.ps1 on Windows." ;;
esac

info "Detected platform: ${BOLD}${PLATFORM}/${ARCH}${RESET}"

# ── Check for required tools ──────────────────────────────────────────────────
need_cmd() {
  if ! command -v "$1" &>/dev/null; then
    return 1
  fi
  return 0
}

# ── Node.js version check ─────────────────────────────────────────────────────
check_node() {
  if need_cmd node; then
    NODE_VER="$(node -e 'process.stdout.write(process.versions.node)')"
    NODE_MAJOR="${NODE_VER%%.*}"
    if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]; then
      success "Node.js ${NODE_VER} found"
      return 0
    else
      warn "Node.js ${NODE_VER} found, but ${REQUIRED_NODE_MAJOR}+ is required"
    fi
  else
    warn "Node.js not found"
  fi
  return 1
}

install_node() {
  echo
  warn "Routerly requires Node.js ${REQUIRED_NODE_MAJOR}+."
  echo -e "  Install options:"
  if [ "$PLATFORM" = "macos" ]; then
    if need_cmd brew; then
      echo -e "  ${DIM}  brew install node${RESET}"
      read -rp "  Install Node.js via Homebrew now? [Y/n] " answer
      if [[ "$answer" =~ ^[Yy]$|^$ ]]; then
        info "Running: brew install node"
        brew install node
        return 0
      fi
    fi
    echo -e "  ${DIM}  brew install node${RESET}"
    echo -e "    or download from https://nodejs.org"
  elif [ "$PLATFORM" = "linux" ]; then
    echo -e "  ${DIM}  Via nvm (recommended):${RESET}"
    echo -e "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    echo -e "    nvm install ${REQUIRED_NODE_MAJOR}"
    echo
    read -rp "  Install Node.js via nvm now? [Y/n] " answer
    if [[ "$answer" =~ ^[Yy]$|^$ ]]; then
      info "Installing nvm..."
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
      export NVM_DIR="$HOME/.nvm"
      # shellcheck disable=SC1091
      [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
      nvm install "$REQUIRED_NODE_MAJOR"
      nvm use "$REQUIRED_NODE_MAJOR"
      return 0
    fi
  fi
  echo
  die "Please install Node.js ${REQUIRED_NODE_MAJOR}+ manually and re-run this script."
}

if ! check_node; then
  install_node
  # Re-check after install
  check_node || die "Node.js ${REQUIRED_NODE_MAJOR}+ still not available. Aborting."
fi

need_cmd npm || die "'npm' not found. Something went wrong with the Node.js install."

# ── Fetch latest release tarball ──────────────────────────────────────────────
info "Fetching latest Routerly release..."

TARBALL_URL=""
RELEASE_API="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest"

if need_cmd curl; then
  RELEASE_JSON="$(curl -fsSL "$RELEASE_API" 2>/dev/null || true)"
elif need_cmd wget; then
  RELEASE_JSON="$(wget -qO- "$RELEASE_API" 2>/dev/null || true)"
else
  die "Neither 'curl' nor 'wget' found. Please install one and retry."
fi

if [ -n "$RELEASE_JSON" ]; then
  # Extract tarball URL from GitHub release assets (look for .tar.gz source code)
  TARBALL_URL="$(echo "$RELEASE_JSON" | \
    grep -o '"tarball_url": *"[^"]*"' | head -1 | \
    sed 's/"tarball_url": *"//' | sed 's/"$//')"
fi

if [ -z "$TARBALL_URL" ]; then
  warn "Could not fetch latest release from GitHub API. Falling back to main branch..."
  TARBALL_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/heads/main.tar.gz"
fi

info "Downloading Routerly from: ${DIM}${TARBALL_URL}${RESET}"

TARBALL_FILE="${TMPDIR_WORK}/routerly.tar.gz"
EXTRACT_DIR="${TMPDIR_WORK}/source"
mkdir -p "$EXTRACT_DIR"

if need_cmd curl; then
  curl -fsSL "$TARBALL_URL" -o "$TARBALL_FILE"
elif need_cmd wget; then
  wget -qO "$TARBALL_FILE" "$TARBALL_URL"
fi

tar -xzf "$TARBALL_FILE" -C "$EXTRACT_DIR" --strip-components=1

success "Downloaded and extracted source"

# ── Run the Node.js installer ─────────────────────────────────────────────────
INSTALLER="${EXTRACT_DIR}/scripts/install.mjs"

if [ ! -f "$INSTALLER" ]; then
  die "Installer not found at expected path: ${INSTALLER}"
fi

info "Launching Routerly installer..."
echo

# Forward all original arguments to the Node.js installer,
# plus pass the source directory so it knows where files are.
exec node "$INSTALLER" "--source-dir=${EXTRACT_DIR}" "$@"
