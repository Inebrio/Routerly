# Providers

Routerly supports multiple LLM providers through a unified adapter interface. Each provider has
a default API endpoint and handles the translation between Routerly's internal format and the
provider's native API.

---

## Supported Providers

| Provider | ID | Default Endpoint | Auth Method | Notes |
|----------|----|-----------------|-------------|-------|
| OpenAI | `openai` | `https://api.openai.com/v1` | API key | GPT-4o, GPT-4-turbo, GPT-3.5-turbo, etc. |
| Anthropic | `anthropic` | `https://api.anthropic.com` | API key | Claude 3.5 Sonnet, Claude 3 Opus, etc. |
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | API key | Gemini 1.5 Pro, Gemini 1.5 Flash, etc. |
| Ollama | `ollama` | `http://localhost:11434/v1` | None | Local models: Llama 3, Mistral, Phi-3, etc. |
| Mistral | `mistral` | - | API key | Mistral Large, Mistral Small, etc. |
| Cohere | `cohere` | - | API key | Command R+, Command R, etc. |
| xAI | `xai` | - | API key | Grok models |
| Custom | `custom` | User-specified | Optional API key | Any OpenAI-compatible endpoint |

---

## Registering a Model

Models are registered with the CLI `model add` command or via the Dashboard > Models page.

```bash
# OpenAI, pricing preset applied automatically for known model IDs
routerly model add --id gpt-4o --provider openai --api-key sk-...

# Anthropic
routerly model add \
  --id claude-3-5-sonnet-20241022 \
  --provider anthropic \
  --api-key sk-ant-...

# Google Gemini
routerly model add \
  --id gemini-1.5-pro \
  --provider gemini \
  --api-key AIza...

# Ollama (local, no key required)
routerly model add \
  --id llama3 \
  --provider ollama \
  --input-price 0 \
  --output-price 0

# Mistral AI
routerly model add \
  --id mistral-large-latest \
  --provider mistral \
  --api-key ...

# Custom OpenAI-compatible endpoint
routerly model add \
  --id my-finetuned-model \
  --provider custom \
  --endpoint https://my-inference-server.example.com/v1 \
  --api-key optional-key \
  --input-price 1.0 \
  --output-price 3.0
```

---

## Built-in Pricing Presets

When you register a model with one of these IDs, pricing is applied automatically without
needing `--input-price` / `--output-price` flags:

| Model ID | Input $/1M | Output $/1M |
|----------|-----------|------------|
| `gpt-4o` | $5.00 | $15.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4-turbo` | $10.00 | $30.00 |
| `gpt-3.5-turbo` | $0.50 | $1.50 |
| `claude-3-5-sonnet-20241022` | $3.00 | $15.00 |
| `claude-3-5-haiku-20241022` | $1.00 | $5.00 |
| `claude-3-opus-20240229` | $15.00 | $75.00 |
| `gemini-1.5-pro` | $1.25 | $5.00 |
| `gemini-1.5-flash` | $0.075 | $0.30 |

All prices are per 1 million tokens in USD.

---

## Model Capabilities

Some routing policies (notably `capability`) use capability flags to match models to requests.
Set capabilities when registering a model or via the Dashboard:

```json
{
  "capabilities": {
    "thinking":        false,
    "vision":          true,
    "functionCalling": true,
    "json":            true
  }
}
```

| Flag | Description | Example models |
|------|-------------|----------------|
| `thinking` | Extended chain-of-thought / reasoning mode | claude-3-7-sonnet, claude-opus-4 |
| `vision` | Image/multimodal inputs | gpt-4o, claude-3.5-sonnet, gemini-1.5-pro |
| `functionCalling` | Tool/function call support | gpt-4o, claude-3.5-sonnet, gemini-1.5-pro |
| `json` | JSON mode / `response_format: json_object` | gpt-4o, gpt-4o-mini |

---

## Custom Provider

The `custom` provider type accepts any OpenAI-compatible endpoint. This is useful for:

- Self-hosted inference servers (vLLM, LM Studio, text-generation-webui)
- Azure OpenAI deployments
- Third-party proxies that speak the OpenAI protocol

```bash
routerly model add \
  --id my-model \
  --provider custom \
  --endpoint https://my-server.com/v1 \
  --api-key Bearer-token-or-leave-empty \
  --input-price 0 \
  --output-price 0
```

---

## Provider Adapter Pattern

Internally, each provider is implemented as a `ProviderAdapter`:

```typescript
interface ProviderAdapter {
  chat(model: ModelConfig, request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  stream(model: ModelConfig, request: ChatCompletionRequest): AsyncGenerator<string>;
}
```

The `providers/index.ts` module maps provider IDs to their adapter implementations and
automatically selects the correct adapter when the executor forwards a request.
