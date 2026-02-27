# LocalRouter

**Self-hosted API gateway for LLMs.** Drop-in replacement for the OpenAI and Anthropic APIs with intelligent routing, cost tracking, budget enforcement, and multi-provider support.

## Quick Start

### 1. Prerequisites

- Node.js ≥ 20
- API keys for the LLM providers you want to use

### 2. Generate a Secret Key

All API keys and tokens are encrypted at rest. Generate a secret before doing anything else:

```bash
# Generate and set the key
LOCALROUTER_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export LOCALROUTER_SECRET_KEY

# Save to your shell profile for persistence
echo "export LOCALROUTER_SECRET_KEY=\"$LOCALROUTER_SECRET_KEY\"" >> ~/.zshrc
```

### 3. Install CLI deps and register your first model

```bash
cd /Users/carlosatta/Documents/lavoro/code/personal/localrouter
npm install

# Register an OpenAI model (pricing preset applied automatically)
node --import tsx/esm packages/cli/src/index.ts model add \
  --id gpt-4o \
  --provider openai \
  --api-key sk-YOUR_OPENAI_KEY

# Register a local Ollama model (no key needed)
node --import tsx/esm packages/cli/src/index.ts model add \
  --id llama3 \
  --provider ollama \
  --input-price 0 \
  --output-price 0
```

### 4. Create a project

```bash
node --import tsx/esm packages/cli/src/index.ts project add \
  --name "My App" \
  --slug my-app \
  --routing-model gpt-4o-mini \
  --models gpt-4o,llama3
```

This prints your **project token** — save it.

### 5. Start the service

```bash
node --import tsx/esm packages/service/src/index.ts
# or in dev mode with hot reload:
npm run dev
```

### 6. Use it from your app

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="YOUR_PROJECT_TOKEN"   # the token printed in step 4
)

response = client.chat.completions.create(
    model="gpt-4o",   # model hint passed to routing model
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## CLI Reference

```
localrouter model list                            # list registered models
localrouter model add --id gpt-4o --provider openai --api-key sk-...
localrouter model remove gpt-4o

localrouter project list
localrouter project add --name "X" --slug x --routing-model gpt-4o
localrouter project add-model --project x --model llama3 --monthly-budget 5.00
localrouter project remove <slug>

localrouter user list
localrouter user add --email admin@example.com --password secret
localrouter user remove admin@example.com

localrouter report usage --period monthly
localrouter report calls --limit 50 --project my-app

localrouter service status
localrouter service configure --port 3000 --log-level debug
```

## Architecture

```
localrouter/
├── packages/
│   ├── shared/       # TypeScript types + AES-256 crypto
│   ├── service/      # Fastify proxy (OpenAI + Anthropic API)
│   ├── cli/          # Admin CLI (Commander.js)
│   └── dashboard/    # React SPA (Phase 4)
```

### Request Flow

1. Client sends request to `/v1/chat/completions` with project Bearer token
2. Service authenticates token → resolves project
3. Service invokes routing model with the request context
4. Routing model returns a weighted list of candidate models
5. Service selects the first candidate within budget
6. Request is forwarded to the selected provider
7. Response returned to client; usage recorded to `~/.localrouter/data/usage.json`
8. If a model errors → fallback to next candidate; all fail → HTTP 503

## Config Location

All config is stored in `~/.localrouter/` by default.
Override with `LOCALROUTER_HOME=/custom/path`.

```
~/.localrouter/
  config/
    settings.json    # port, host, log level, dashboard toggle
    models.json      # providers + encrypted API keys + pricing
    projects.json    # projects + encrypted tokens + model lists
    users.json       # dashboard users
    roles.json       # roles and permissions
  data/
    usage.json       # per-call usage records
```
