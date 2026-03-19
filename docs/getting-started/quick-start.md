# Quick Start

From zero to your first routed AI response in under 5 minutes.

---

## 1. Install

**macOS / Linux:**
```bash
curl -fsSL https://github.com/Inebrio/Routerly/releases/latest/download/install.sh | bash
```

**Windows (PowerShell — run as Administrator for system-wide install):**
```powershell
powershell -c "irm https://github.com/Inebrio/Routerly/releases/latest/download/install.ps1 | iex"
```

The installer will:
- Check (or offer to install) Node.js 20+
- Download and build the latest release
- Ask which components to install (service, CLI, dashboard)
- Optionally configure auto-start at boot
- **Run a setup wizard** to create an admin user, register a model, and create a project

When the wizard finishes, it prints a **project token** — save it, it won't be shown again.

After installation, open a **new terminal** so that PATH is updated.

---

## 2. Verify

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"..."}
```

---

## 3. First request

Replace `YOUR_PROJECT_TOKEN` with the token printed by the wizard.

**cURL:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROJECT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'
```

**Python (OpenAI SDK):**
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="YOUR_PROJECT_TOKEN"
)
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

That's it. Routerly is running, routing, and tracking costs.

---

## Next Steps

| I want to… | Where to go |
|---|---|
| Add more models (Anthropic, Ollama, Gemini…) | [CLI → `routerly model add`](../cli/commands.md) |
| Create more projects with separate tokens | [CLI → `routerly project add`](../cli/commands.md) |
| Set a monthly spend cap on a project | [Budgets & Limits](../service/budgets-and-limits.md) |
| Tune routing policies (cheapest, LLM, health…) | [Routing Engine](../service/routing.md) |
| Open the web dashboard | Browse to `http://localhost:3000/dashboard/` |
| Use the Anthropic SDK instead of OpenAI | [API Reference](../service/api-reference.md) |
| Install without the wizard / non-interactive (CI) | [Installation options](installation.md) |
| Understand the full config file structure | [Configuration](configuration.md) |
| Re-install, update, or uninstall | [Managing an existing install](installation.md#managing-an-existing-installation) |

---

## Manual setup (if you skipped the wizard)

If you chose to skip the wizard during installation, complete the setup manually:

### Log in to the CLI

```bash
routerly auth login --url http://localhost:3000
```

### Register a model

```bash
# OpenAI
routerly model add --id gpt-4o --provider openai --api-key sk-YOUR_OPENAI_KEY

# Anthropic
routerly model add --id claude-3-5-sonnet-20241022 --provider anthropic --api-key sk-ant-YOUR_KEY

# Ollama (local, no key needed)
routerly model add --id llama3 --provider ollama --input-price 0 --output-price 0
```

### Create a project

```bash
routerly project add \
  --name "My App" \
  --slug my-app \
  --routing-model gpt-4o \
  --models gpt-4o
```

The command prints your **project token** (shown only once) and the endpoint prefix to use as `base_url`.
