---
title: Troubleshooting
sidebar_position: 3
---

# Troubleshooting

## Service Won't Start

### Port already in use

**Symptom:** `Error: listen EADDRINUSE :::3000`

**Fix:**

```bash
# Find what is using port 3000
lsof -i :3000

# Change Routerly's port in settings
routerly service configure --port 3001
# or edit ~/.routerly/config/settings.json directly
```

### Config file has invalid JSON

**Symptom:** Service exits immediately with a JSON parse error in the logs.

**Fix:**

```bash
# Validate all config files
for f in ~/.routerly/config/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK: $f" || echo "INVALID: $f"
done
```

Fix the reported file by hand or restore from a backup.

---

## Authentication Errors

### 401 on the LLM proxy — "Invalid or missing Authorization header"

**Likely causes:**
- Missing `Authorization: Bearer sk-lr-…` header
- The project token was rotated or deleted
- The token was typed incorrectly

**Fix:** Verify the token in the dashboard under **Projects → Tokens**. Generate a new token if needed; old tokens cannot be recovered.

### 401 on the management API — "JWT expired"

**Symptom:** Dashboard shows a login prompt; CLI returns `Unauthorized`.

**Fix:**

```bash
# Re-authenticate
routerly auth login
```

Dashboard sessions expire after 24 hours. The CLI persists credentials and prompts for re-login automatically.

---

## Model and Provider Errors

### Model unreachable / 502 from provider

**Symptom:** Requests return HTTP 502 with a message like `"provider error: …"`.

**Fixes:**
1. Verify the API key is correct in the dashboard under **Models → Edit**.
2. Check that the model ID matches the provider's exact ID (e.g. `gpt-5-mini`, not `gpt5mini`).
3. Test connectivity to the provider from the server:
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer YOUR_API_KEY"
   ```

### Ollama unreachable

**Symptom:** Requests to Ollama models fail with a connection error.

**Fixes:**
1. Ensure the Ollama process is running: `ollama serve`
2. Confirm the `baseUrl` for your Ollama model points to the correct host and port (default: `http://localhost:11434`)
3. If Routerly runs in Docker and Ollama runs on the host, use `http://host.docker.internal:11434` as `baseUrl`

---

## Budget and Limit Errors

### 503 — "Budget exceeded"

**Symptom:** Requests return HTTP 503 with `"Budget limit reached"`.

**Fixes:**
1. Open the dashboard → **Projects → [Project] → Tokens** to see which budget was hit and when it resets.
2. Increase the budget limit or wait for the current window to reset.
3. If a **Global** budget is the issue, an admin must adjust it in the dashboard → **Overview** or **Settings**.

---

## Routing Issues

### All requests use the same model (ignoring policies)

**Symptom:** The routing policy is set to `random` or `round-robin`, but the same model is always selected.

**Fix:** Check that more than one model is assigned to the project. A project with only one model always routes to that model regardless of policy.

### Preferred model is never selected

**Symptom:** The `preferred` or `priority` policy is configured, but a different model is chosen.

**Fix:** Verify that the preferred model is **enabled** (not disabled) and assigned to the project.

---

## Dashboard Issues

### Dashboard shows blank page after login

**Symptom:** URL changes to `/overview` but the page is empty.

**Fixes:**
- Hard-refresh the browser (`Cmd+Shift+R` / `Ctrl+Shift+R`) to clear the cached JS bundle.
- Check the browser console for JS errors.

### Setup page appears even after completing setup

**Symptom:** Visiting the dashboard always redirects to the setup wizard.

**Fix:** Check that at least one user with the `admin` role exists in `~/.routerly/config/users.json`. If the file is empty or was accidentally deleted, the service treats itself as unconfigured.

---

## Getting More Information

### Enable debug logging

```bash
# Temporarily (environment variable)
ROUTERLY_LOG_LEVEL=debug routerly-service

# Persistently
routerly service configure --log-level debug
```

### View service logs

```bash
# systemd user service
journalctl --user -u routerly -f

# systemd system service
sudo journalctl -u routerly -f

# Docker
docker compose logs -f routerly

# launchd (macOS)
tail -f ~/.routerly/logs/output.log
```

### Check service status

```bash
routerly status
```

This prints the service URL, version, uptime, and a summary of loaded configuration.
