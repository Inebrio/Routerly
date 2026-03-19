# Installation

This guide walks you through installing Routerly. Three paths are available: the one-line installer (recommended), Docker (best for servers and containerised stacks), and a manual setup for contributors.

---

## Automated Install (recommended)

The installer handles everything: Node.js check, download, build, encryption key generation, shell profile update, optional daemon setup, and an interactive setup wizard.

**macOS / Linux:**
```bash
curl -fsSL https://github.com/Inebrio/Routerly/releases/latest/download/install.sh | bash
```

**Windows (PowerShell):**
```powershell
powershell -c "irm https://github.com/Inebrio/Routerly/releases/latest/download/install.ps1 | iex"
```

### What the installer does

1. Verifies (or installs) Node.js 20+
2. Downloads and extracts the latest release tarball from GitHub
3. Prompts for component selection and config options
4. Builds all selected packages
5. Writes `~/.routerly/config/settings.json`
6. Installs the `routerly` CLI wrapper in `~/.local/bin`
7. Optionally configures an auto-start daemon (systemd / launchd / Windows Service)
8. Optionally runs a setup wizard to add a model, create a project, and create an admin user

---

## Installer options

All flags can be passed after `--` when piping through bash:

```bash
curl -fsSL .../install.sh | bash -s -- [flags]
```

Or run the script file directly after downloading:

```bash
bash install.sh [flags]
```

| Flag | Description | Default |
|------|--------------|---------|
| `--yes` | Non-interactive, accept all defaults | off |
| `--scope=user\|system` | Install for current user or system-wide (system requires sudo) | `user` |
| `--port=N` | Service port | `3000` |
| `--public-url=URL` | Public URL for the service | `http://localhost:PORT` |
| `--no-service` | Skip service installation | off |
| `--no-cli` | Skip CLI installation | off |
| `--no-dashboard` | Skip dashboard build | off |
| `--no-daemon` | Skip auto-start daemon setup | off |

### Non-interactive mode

Useful for CI/CD pipelines and automated provisioning:

```bash
curl -fsSL .../install.sh | bash -s -- --yes
```

For full control, combine `--yes` with environment variables:

| Variable | Values | Description |
|----------|--------|-------------|
| `ROUTERLY_SCOPE` | `user` / `system` | Installation scope |
| `ROUTERLY_PORT` | number | Service port |
| `ROUTERLY_PUBLIC_URL` | URL | Public URL |
| `ROUTERLY_INSTALL_SERVICE` | `1` / `0` | Install the service |
| `ROUTERLY_INSTALL_CLI` | `1` / `0` | Install the CLI |
| `ROUTERLY_INSTALL_DASHBOARD` | `1` / `0` | Build and install the dashboard |
| `ROUTERLY_DAEMON` | `1` / `0` | Configure auto-start daemon |

```bash
ROUTERLY_SCOPE=system \
ROUTERLY_PORT=8080 \
ROUTERLY_DAEMON=0 \
bash install.sh --yes
```

### Installation directories

| | User scope | System scope |
|---|---|---|
| App files | `~/.routerly/app/` | `/opt/routerly/` |
| CLI binary | `~/.local/bin/routerly` | `/usr/local/bin/routerly` |
| Config & data | `~/.routerly/` | `~/.routerly/` (per user) |

### Auto-start daemon

When daemon setup is selected, the installer configures the appropriate mechanism for your OS:

| OS | Scope | Mechanism |
|----|-------|-----------|
| Linux | user | systemd user unit (`~/.config/systemd/user/routerly.service`) |
| Linux | system | systemd system unit (`/etc/systemd/system/routerly.service`) |
| macOS | user | launchd agent (`~/Library/LaunchAgents/ai.routerly.service.plist`) |
| macOS | system | launchd daemon (`/Library/LaunchDaemons/ai.routerly.service.plist`) |
| Windows | — | Windows Service via `sc.exe` |

---

## Managing an existing installation

Re-running the installer on a machine where Routerly is already installed shows a menu:

```
What would you like to do?
  1  Update      — download & rebuild latest code, keep all settings
  2  Reinstall   — change components or settings (user data preserved)
  3  Uninstall   — remove Routerly from this machine
  0  Cancel
```

**Update** rebuilds the app from the latest release without touching any configuration files, API keys, users, or usage data.

**Reinstall** reruns the full configuration wizard so you can change the port, components, or daemon settings. All user data is preserved.

**Uninstall** stops the daemon, removes all app files and CLI wrappers, and optionally removes user data too.

Run the installer again to get this menu:

```bash
# macOS / Linux
curl -fsSL https://github.com/Inebrio/Routerly/releases/latest/download/install.sh | bash

# Windows
powershell -c "irm https://github.com/Inebrio/Routerly/releases/latest/download/install.ps1 | iex"
```

---

## Verify installation

After installation (restart your terminal first to pick up the updated PATH):

```bash
routerly --version
curl http://localhost:3000/health
# {"status":"ok","version":"..."}
```

---

## Docker

Docker is the simplest way to run Routerly on a server or inside an existing containerised stack — no Node.js required on the host.

### Quick start with Docker Compose

```bash
# clone the repository (or download docker-compose.yml individually)
git clone https://github.com/Inebrio/Routerly.git
cd Routerly

docker compose up -d
```

The service will be available at `http://localhost:3000`.
Config and data are automatically persisted in a named Docker volume (`routerly_data`).

### Manual Docker run

Build the image yourself:

```bash
docker build -t routerly .
```

Then start a container:

```bash
docker run -d \
  --name routerly \
  -p 3000:3000 \
  -v routerly_data:/data \
  -e NODE_ENV=production \
  -e ROUTERLY_HOME=/data \
  routerly
```

### Persistent data

| Inside container | Host (named volume) | Purpose |
|-----------------|---------------------|---------|
| `/data` | `routerly_data` | Config files, token store, SQLite database |

All state lives under `ROUTERLY_HOME`, which defaults to `/data` in the Docker image.
You can substitute a bind-mount path for the named volume if you prefer to manage the directory yourself:

```bash
-v /your/local/path:/data
```

### Using the CLI inside Docker

The `routerly` CLI is bundled in the image and available via `docker exec`:

```bash
docker exec routerly routerly --help
docker exec routerly routerly model list
docker exec routerly routerly project list
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `ROUTERLY_HOME` | `/data` | Config and data directory |
| `ROUTERLY_PORT` | `3000` | Listening port (override `ports:` mapping too) |

### Health check

Docker polls the built-in health endpoint automatically:

```bash
docker inspect --format='{{.State.Health.Status}}' routerly
# healthy
```

Or manually:

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.0.1","timestamp":"..."}
```

---

## Manual install (for contributors / development)

If you want to work on Routerly itself or prefer a hand-crafted setup:

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | ≥ 20 | Required for all packages |
| **npm** | ≥ 10 | Comes with Node.js |
| **LLM provider API keys** | — | At least one key unless using Ollama |

```bash
node --version   # should print v20 or higher
npm --version
```

### Clone and install

```bash
git clone https://github.com/Inebrio/Routerly.git
cd Routerly
npm install
```

### Start in development mode

```bash
npm run dev
```

This starts the service with `tsx` in watch mode. The service, CLI, and dashboard all run from source.

```bash
# Health check
curl http://localhost:3000/health
# {"status":"ok","version":"0.0.1","timestamp":"..."}
```

---

## Next steps

→ [Quick Start](quick-start.md): register a model, create a project, make your first API call
→ [Configuration](configuration.md): ports, log levels, custom storage path
