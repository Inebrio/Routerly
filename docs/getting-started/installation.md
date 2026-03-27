---
title: Installation
sidebar_position: 1
---

# Installation

Routerly can be installed with a one-line script on macOS, Linux, and Windows. Docker is also supported for containerised deployments.

---

## One-line Installer (Recommended)

### macOS / Linux

```bash
curl -fsSL https://www.routerly.ai/install.sh | bash
```

The installer will:
1. Detect your OS and architecture
2. Download the latest Routerly release
3. Install the service and CLI binaries
4. Optionally configure a system daemon (systemd on Linux, launchd on macOS)
5. Start the service

#### Installer flags

You can customise the installation by passing flags after `--`:

```bash
curl -fsSL https://www.routerly.ai/install.sh | bash -s -- \
  --yes                     # Non-interactive; accept all defaults
  --scope user              # Install for current user only (default)
  --scope system            # System-wide install (requires sudo)
  --port 8080               # Use a custom port (default: 3000)
  --public-url https://routerly.example.com  # External URL of the service
  --no-service              # Skip service installation (CLI only)
  --no-daemon               # Skip auto-start setup
```

#### Installation scopes

| Scope | App directory | CLI binary |
|-------|--------------|------------|
| `user` (default) | `~/.routerly/app/` | `~/.local/bin/routerly` |
| `system` | `/opt/routerly/` | `/usr/local/bin/routerly` |

The **service config and data directory** depends on both scope and platform:

| Scope | Linux | macOS | Windows |
|-------|-------|-------|---------|
| `user` | `~/.routerly/` | `~/.routerly/` | `%USERPROFILE%\.routerly\` |
| `system` | `/var/lib/routerly/` | `/Library/Application Support/Routerly/` | `C:\ProgramData\Routerly\` |

:::note
System scope requires `sudo`. The installer sets `ROUTERLY_HOME` in the daemon unit file so the service always reads the correct directory automatically.
:::

:::info CLI auth tokens are always per-user
Regardless of scope, each user's CLI credentials (JWT tokens, refresh tokens) are stored in `~/.routerly/cli/config.json` with mode `0600`. They are never placed in the system config directory.
:::

### Windows

```powershell
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"
```

This installs Routerly as a Windows Service and adds the CLI to your PATH.

---

## Docker

Two options are available: pull the pre-built image from Docker Hub (recommended), or build it yourself from source.

### Option 1 — Pre-built image (Docker Hub)

The official image is published on [Docker Hub](https://hub.docker.com/r/inebrio/routerly) for `linux/amd64` and `linux/arm64`.

#### docker-compose (recommended)

Create a `docker-compose.yml`:

```yaml
services:
  routerly:
    image: inebrio/routerly:latest
    ports:
      - "3000:3000"
    volumes:
      - routerly_data:/data
    environment:
      - ROUTERLY_HOME=/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  routerly_data:
```

```bash
docker compose up -d
```

#### docker run

```bash
docker run -d \
  --name routerly \
  -p 3000:3000 \
  -v routerly_data:/data \
  -e ROUTERLY_HOME=/data \
  --restart unless-stopped \
  inebrio/routerly:latest
```

### Option 2 — Build from source

Use this if you want to run a local branch or a customised build.

```bash
git clone https://github.com/Inebrio/Routerly.git
cd Routerly
docker build -t routerly:local .
docker run -d \
  --name routerly \
  -p 3000:3000 \
  -v routerly_data:/data \
  -e ROUTERLY_HOME=/data \
  --restart unless-stopped \
  routerly:local
```

Or with docker-compose, add a `docker-compose.override.yml` next to your existing `docker-compose.yml`:

```yaml
services:
  routerly:
    build: ./Routerly
    image: routerly:local
```

```bash
docker compose up -d --build
```

---

## Manual Installation (from source)

Requirements: **Node.js ≥ 20**, **npm ≥ 10**

```bash
git clone https://github.com/Inebrio/Routerly.git
cd Routerly
npm install
npm run build
npm run start --workspace=packages/service
```

The CLI is available via:

```bash
node packages/cli/dist/index.js
```

---

## Updating Routerly

Run the installer again — it detects an existing installation and presents a menu:

```bash
# macOS / Linux
curl -fsSL https://www.routerly.ai/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"
```

When an existing install is found you will see:

```
  Existing installation detected

  What would you like to do?

    1  Update      — download & rebuild latest code, keep all settings
    2  Reinstall   — change components or settings (user data preserved)
    3  Uninstall   — remove Routerly from this machine
    0  Cancel
```

Select **1** (or press Enter to accept the default) to download and rebuild the latest release. All configuration and user data are preserved.

To update without prompts (e.g. in a script or CI):

```bash
curl -fsSL https://www.routerly.ai/install.sh | bash -s -- --yes
```

---

## Reinstalling

Reinstalling lets you change installed components (service, CLI, dashboard) or reconfigure settings (port, scope, daemon) while keeping all user data intact.

Run the installer and select **2** at the menu:

```bash
# macOS / Linux
curl -fsSL https://www.routerly.ai/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"
```

The wizard will walk you through the same questions as a fresh install, pre-filling your existing answers. All accounts, projects, models and usage history are preserved.

---

## Uninstalling

Run the installer and select **3** at the menu:

```bash
# macOS / Linux
curl -fsSL https://www.routerly.ai/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"
```

The uninstall flow will:

1. Stop and remove the system daemon (systemd / launchd / Windows Service)
2. Remove the application files and CLI binary
3. Ask whether to also delete user data (`~/.routerly/` — accounts, settings, usage history)

:::note Data preservation
If you answer **No** to the data removal prompt, all accounts and history are kept. Running the installer again will detect the existing data and offer to resume from where you left off.
:::

---

## Auto-start Configuration

The installer can configure Routerly to start automatically on boot:

| OS | Scope | Method | Location |
|----|-------|--------|----------|
| Linux | user | systemd user service | `~/.config/systemd/user/routerly.service` |
| Linux | system | systemd system service | `/etc/systemd/system/routerly.service` |
| macOS | user | launchd LaunchAgent | `~/Library/LaunchAgents/ai.routerly.service.plist` |
| macOS | system | launchd LaunchDaemon | `/Library/LaunchDaemons/ai.routerly.service.plist` |
| Windows | — | Windows Service | via `sc.exe` |

To start/stop manually:

```bash
# Linux (user scope)
systemctl --user start routerly
systemctl --user stop routerly

# macOS (user scope)
launchctl load ~/Library/LaunchAgents/ai.routerly.service.plist
launchctl unload ~/Library/LaunchAgents/ai.routerly.service.plist
```

---

## Verifying the Installation

```bash
routerly status
```

You should see the service URL, version, and a reachability check. Then open the dashboard:

```
http://localhost:3000/dashboard
```

→ Continue to [Quick Start](./quick-start.md) to set up your first model and project.
