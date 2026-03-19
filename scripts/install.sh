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
GITHUB_OWNER="Inebrio"
GITHUB_REPO="Routerly"
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

# ── Try to load Node.js from known locations ──────────────────────────────────
# When running via `curl | bash` the shell is non-interactive: .bashrc/.zshrc
# are NOT sourced, so nvm, Homebrew and other package managers may be invisible.
# This function probes the most common install locations and patches PATH/env
# so that subsequent `node` calls work without requiring a new login shell.
try_load_node_paths() {
  # ── nvm ──────────────────────────────────────────────────────────────────────
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$nvm_dir/nvm.sh" ]; then
    # shellcheck disable=SC1091
    source "$nvm_dir/nvm.sh" --no-use 2>/dev/null || true
    # Also try to point at the default/lts alias without switching global version
    if command -v nvm &>/dev/null; then
      nvm use default 2>/dev/null || nvm use node 2>/dev/null || true
    fi
  fi

  # ── Homebrew (macOS — Intel and Apple Silicon) ────────────────────────────────
  for brew_bin in /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$brew_bin/brew" ] && [[ ":$PATH:" != *":$brew_bin:"* ]]; then
      export PATH="$brew_bin:$PATH"
    fi
  done

  # ── Common system paths (Linux distros, manual installs) ─────────────────────
  for dir in /usr/local/bin /usr/bin /usr/sbin /snap/bin; do
    if [ -d "$dir" ] && [[ ":$PATH:" != *":$dir:"* ]]; then
      export PATH="$dir:$PATH"
    fi
  done

  # ── Volta ─────────────────────────────────────────────────────────────────────
  if [ -d "$HOME/.volta/bin" ] && [[ ":$PATH:" != *":$HOME/.volta/bin:"* ]]; then
    export PATH="$HOME/.volta/bin:$PATH"
  fi

  # ── fnm ───────────────────────────────────────────────────────────────────────
  if command -v fnm &>/dev/null; then
    eval "$(fnm env 2>/dev/null)" || true
  fi
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

  # ── Detect available package managers ─────────────────────────────────────
  local options=()   # display labels
  local methods=()   # internal keys

  # nvm is always offered (works on both macOS and Linux, no root needed)
  options+=("nvm  (Node Version Manager — recommended, no sudo needed)")
  methods+=("nvm")

  if [ "$PLATFORM" = "macos" ]; then
    if need_cmd brew; then
      options+=("brew (Homebrew)")
      methods+=("brew")
    else
      options+=("brew (Homebrew — will install Homebrew first)")
      methods+=("brew-install")
    fi
  fi

  if [ "$PLATFORM" = "linux" ]; then
    # Detect the Linux distro package manager
    if need_cmd apt-get; then
      options+=("apt  (Debian/Ubuntu — requires sudo)")
      methods+=("apt")
    elif need_cmd dnf; then
      options+=("dnf  (Fedora/RHEL — requires sudo)")
      methods+=("dnf")
    elif need_cmd pacman; then
      options+=("pacman (Arch Linux — requires sudo)")
      methods+=("pacman")
    elif need_cmd zypper; then
      options+=("zypper (openSUSE — requires sudo)")
      methods+=("zypper")
    fi
  fi

  options+=("manual — I'll install Node.js myself")
  methods+=("manual")

  # ── Print menu ─────────────────────────────────────────────────────────────
  echo -e "\n  How would you like to install Node.js ${REQUIRED_NODE_MAJOR}?\n"
  local i
  for i in "${!options[@]}"; do
    echo -e "    ${BOLD}$((i+1))${RESET}  ${options[$i]}"
  done
  echo

  local choice method
  read -rp "  Choose an option [1]: " choice </dev/tty
  choice="${choice:-1}"

  # Validate input is a number in range
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#methods[@]}" ]; then
    warn "Invalid choice, defaulting to option 1."
    choice=1
  fi

  method="${methods[$((choice-1))]}"

  # ── Execute chosen method ──────────────────────────────────────────────────
  case "$method" in

    nvm)
      info "Installing nvm and Node.js ${REQUIRED_NODE_MAJOR}..."
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
      export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
      # shellcheck disable=SC1091
      [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
      nvm install "$REQUIRED_NODE_MAJOR"
      nvm use "$REQUIRED_NODE_MAJOR"
      ;;

    brew)
      info "Running: brew install node"
      brew install node
      ;;

    brew-install)
      info "Installing Homebrew first..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      # Add brew to PATH for this session (Apple Silicon vs Intel)
      if [ -x "/opt/homebrew/bin/brew" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
      elif [ -x "/usr/local/bin/brew" ]; then
        eval "$(/usr/local/bin/brew shellenv)"
      fi
      info "Running: brew install node"
      brew install node
      ;;

    apt)
      info "Installing Node.js ${REQUIRED_NODE_MAJOR} via apt..."
      curl -fsSL "https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | sudo -E bash -
      sudo apt-get install -y nodejs
      ;;

    dnf)
      info "Installing Node.js ${REQUIRED_NODE_MAJOR} via dnf..."
      curl -fsSL "https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | sudo bash -
      sudo dnf install -y nodejs
      ;;

    pacman)
      info "Installing nodejs via pacman..."
      sudo pacman -Sy --noconfirm nodejs npm
      ;;

    zypper)
      info "Installing nodejs via zypper..."
      sudo zypper install -y nodejs"${REQUIRED_NODE_MAJOR}"
      ;;

    manual)
      echo
      echo -e "  Please install Node.js ${REQUIRED_NODE_MAJOR}+ from one of these sources:"
      echo -e "    ${DIM}https://nodejs.org/en/download${RESET}"
      echo -e "    ${DIM}https://github.com/nvm-sh/nvm${RESET}"
      echo
      die "Re-run this script after installing Node.js ${REQUIRED_NODE_MAJOR}+."
      ;;
  esac
}

# Probe known Node.js locations before checking (nvm/brew/volta/fnm are not
# in PATH when running via `curl | bash` — shell is non-interactive)
try_load_node_paths
if ! check_node; then
  install_node
  # Re-check after install: reload paths first (nvm/brew may have just been set up)
  try_load_node_paths
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
