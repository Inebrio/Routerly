---
title: Self-Hosting
sidebar_position: 1
---

# Self-Hosting

This guide covers production deployment options for Routerly: Docker, systemd, launchd (macOS), and Windows Service. It also includes reverse-proxy configuration and a production readiness checklist.

---

## Docker (Recommended)

Docker is the easiest way to run Routerly in production. Data persists in a named volume.

Two options are available: pull the pre-built image from Docker Hub, or build locally from source.

### Option 1 — Pre-built image (Docker Hub)

The official image is published on [`inebrio/routerly`](https://hub.docker.com/r/inebrio/routerly) for `linux/amd64` and `linux/arm64`.

### docker-compose.yml

```yaml
services:
  routerly:
    image: inebrio/routerly:latest
    container_name: routerly
    ports:
      - "3000:3000"
    volumes:
      - routerly_data:/data
    environment:
      - ROUTERLY_HOME=/data
      - NODE_ENV=production
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
docker compose logs -f    # follow logs
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

### Backup

```bash
# Backup config and data
docker run --rm \
  -v routerly_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/routerly-backup-$(date +%Y%m%d).tar.gz -C /data .
```

---

## systemd (Linux)

### User service (no root required)

Create `~/.config/systemd/user/routerly.service`:

```ini
[Unit]
Description=Routerly LLM Gateway
After=network.target

[Service]
ExecStart=/home/USERNAME/.routerly/app/routerly-service
WorkingDirectory=/home/USERNAME/.routerly
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable routerly
systemctl --user start routerly
systemctl --user status routerly
```

### System service (root)

Create `/etc/systemd/system/routerly.service`:

```ini
[Unit]
Description=Routerly LLM Gateway
After=network.target

[Service]
User=routerly
Group=routerly
ExecStart=/opt/routerly/app/routerly-service
WorkingDirectory=/opt/routerly
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
useradd --system --home /opt/routerly routerly
systemctl daemon-reload
systemctl enable --now routerly
```

---

## launchd (macOS)

Create `~/Library/LaunchAgents/ai.routerly.service.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.routerly.service</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/USERNAME/.routerly/app/routerly-service</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/USERNAME/.routerly/logs/output.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/USERNAME/.routerly/logs/error.log</string>
</dict>
</plist>
```

```bash
mkdir -p ~/.routerly/logs
launchctl load ~/Library/LaunchAgents/ai.routerly.service.plist
```

---

## Reverse Proxy

**Always** place Routerly behind a reverse proxy in production to handle TLS termination, rate limiting, and access control.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name routerly.example.com;

    ssl_certificate     /etc/letsencrypt/live/routerly.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/routerly.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_buffering    off;   # Required for SSE streaming
        proxy_read_timeout 120s;
    }
}
```

### Caddy

```caddyfile
routerly.example.com {
    reverse_proxy localhost:3000 {
        flush_interval -1   # Required for SSE streaming
    }
}
```

---

## Production Checklist

- [ ] Routerly is behind a reverse proxy with TLS
- [ ] `publicUrl` in Settings is set to the external HTTPS URL
- [ ] `host` is set to `127.0.0.1` (bind only to localhost, let the proxy handle external traffic)
- [ ] `logLevel` is set to `warn` or `error` to reduce log volume
- [ ] `~/.routerly/config/secret` and `config/*.json` are backed up
- [ ] Notification channels are configured for budget alerts
- [ ] A global budget limit is set to prevent unbounded spending
- [ ] Dashboard access is restricted to internal network or behind auth if the public URL is externally accessible
