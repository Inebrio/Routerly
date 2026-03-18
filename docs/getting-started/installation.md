# Installation

This guide walks you through installing Routerly and getting it ready to run.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | ≥ 20 | Required for all packages |
| **npm** | ≥ 10 | Comes with Node.js |
| **LLM provider API keys** | — | At least one key (OpenAI, Anthropic, Gemini, etc.) unless using Ollama |

To check your versions:

```bash
node --version   # should print v20 or higher
npm --version
```

---

## Install Dependencies

Clone the repository and install all workspace dependencies:

```bash
git clone https://github.com/your-org/routerly.git
cd routerly
npm install
```

This installs dependencies for all four packages (`shared`, `service`, `cli`, `dashboard`) via npm workspaces.

---

## Generate a Secret Key

Routerly encrypts all sensitive data (API keys, project tokens) at rest using AES-256.
You must set a `ROUTERLY_SECRET_KEY` before doing anything else.

```bash
# Generate a random 256-bit key
ROUTERLY_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export ROUTERLY_SECRET_KEY

# Persist it in your shell profile
echo "export ROUTERLY_SECRET_KEY=\"$ROUTERLY_SECRET_KEY\"" >> ~/.zshrc
# or for bash:
echo "export ROUTERLY_SECRET_KEY=\"$ROUTERLY_SECRET_KEY\"" >> ~/.bashrc
```

> **Important:** If this key is lost or changes, all stored API keys and tokens will become unreadable.
> Store the key securely (e.g. in a password manager or secrets manager).

---

## Verify Installation

Start the service to confirm everything is working:

```bash
npm run dev
```

You should see:

```
[INFO] Server listening at http://127.0.0.1:3000
```

Hit the health endpoint to confirm:

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.0.1","timestamp":"..."}
```

---

## Next Steps

→ [Quick Start](quick-start.md) — register a model, create a project, make your first API call
