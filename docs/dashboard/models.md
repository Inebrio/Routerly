# Models

The **Models** page lets you register, configure, and remove LLM provider models through the dashboard UI.

---

## Listing Models

Navigate to **Models** in the sidebar. The table shows:

- Model ID
- Provider
- Endpoint URL
- Input cost ($/1M tokens)
- Output cost ($/1M tokens)
- Capabilities (vision, function calling, thinking, JSON mode)
- Global limits

---

## Registering a New Model

Click **Add Model** to open the registration form.

### Required Fields

| Field | Description |
|-------|-------------|
| **Model ID** | Unique identifier (e.g. `gpt-4o`, `my-llama3`). Used in API requests and routing |
| **Provider** | Select from: `openai`, `anthropic`, `gemini`, `ollama`, `mistral`, `cohere`, `xai`, `custom` |

### Optional Fields

| Field | Description |
|-------|-------------|
| **Endpoint** | Override the default provider endpoint. Leave blank to use the provider default |
| **API Key** | Provider API key. Stored encrypted at rest using AES-256 |
| **Display Name** | Human-readable label (defaults to Model ID) |
| **Input price ($/1M)** | Cost per million input tokens in USD. Auto-populated for known model IDs |
| **Output price ($/1M)** | Cost per million output tokens in USD. Auto-populated for known model IDs |
| **Cached input price ($/1M)** | Cost per million cached prompt tokens (relevant for Anthropic and OpenAI) |

### Pricing Presets

If the Model ID matches a known preset, pricing is filled in automatically:

| Model ID | Input | Output |
|----------|-------|--------|
| `gpt-4o` | $5.00 | $15.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4-turbo` | $10.00 | $30.00 |
| `gpt-3.5-turbo` | $0.50 | $1.50 |
| `claude-3-5-sonnet-20241022` | $3.00 | $15.00 |
| `claude-3-5-haiku-20241022` | $1.00 | $5.00 |
| `claude-3-opus-20240229` | $15.00 | $75.00 |
| `gemini-1.5-pro` | $1.25 | $5.00 |
| `gemini-1.5-flash` | $0.075 | $0.30 |

### Capabilities

Check the relevant boxes to tell the routing engine what this model supports:

- **Vision** — accepts image inputs
- **Function calling** — supports tool/function calls
- **Thinking** — extended reasoning mode (e.g. claude-3-7-sonnet)
- **JSON mode** — reliable JSON output (`response_format: json_object`)

### Global Limits

Add one or more spend/usage limits that apply globally across all projects:

- Click **Add Limit**
- Choose metric, window type, and value
- Multiple limits are AND-combined (all must pass)

See [Budgets & Limits](../service/budgets-and-limits.md) for the full reference.

---

## Editing a Model

Click the **Edit** (pencil) icon on any model row to update its configuration.

> API keys are never shown after initial save. To rotate a key, edit the model and enter the new key.

---

## Removing a Model

Click the **Delete** (trash) icon. A confirmation dialog is shown.

> Models assigned to active projects cannot be deleted. Remove them from all projects first.

---

## See Also

- [CLI: model commands](../cli/commands.md#model) — manage models from the terminal
- [Providers](../service/providers.md) — supported providers and default endpoints
