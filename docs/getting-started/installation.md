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

| Scope | App directory | CLI binary | Config directory |
|-------|--------------|------------|-----------------|
| `user` (default) | `~/.routerly/app/` | `~/.local/bin/routerly` | `~/.routerly/` |
| `system` | `/opt/routerly/` | `/usr/local/bin/routerly` | `~/.routerly/` |

:::note
System scope requires `sudo`. Config and data always stay in `~/.routerly/` regardless of scope.
:::

### Windows

```powershell
powershell -c "irm https://www.routerly.ai/install.ps1 | iex"
```

This installs Routerly as a Windows Service and adds the CLI to your PATH.

---

## Docker

The official Docker image is the recommended way to run Routerly in production.

### docker-compose (recommended)

Create a `docker-compose.yml`:

```yaml
services:
  routerly:
    image: ghcr.io/inebrio/routerly:latest
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

Then start it:

```bash
docker compose up -d
```

### docker run

```bash
docker run -d \
  --name routerly \
  -p 3000:3000 \
  -v routerly_data:/data \
  -e ROUTERLY_HOME=/data \
  --restart unless-stopped \
  ghcr.io/inebrio/routerly:latest
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

Run the installer again — it detects an existing installation and offers an update:

```bash
curl -fsSL https://www.routerly.ai/install.sh | bash
```

---

## Uninstalling

```bash
curl -fsSL https://www.routerly.ai/install.sh | bash -s -- --uninstall
```

This removes the application files and daemon. Your config and usage data in `~/.routerly/` are preserved.

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
