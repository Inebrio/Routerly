# Provider compatibility reference

Facts about what each upstream provider accepts and rejects, collected from official documentation only. Routerly uses this to define per-provider compatibility profiles: small, declarative sets of rules that `withCompat` / `normalizeForModel` (`packages/service/src/modules/provider/compat/`) apply to a request before it leaves the gateway.

Principles (see `CLAUDE.md`, wire-format transparency):

- A profile rule changes the payload only when the target provider would otherwise reject it, and only by the minimum needed.
- Anything not confirmed in official docs is listed in "Gaps and unconfirmed items" and must not be turned into a rule from memory.

Conventions:

- Every claim cites a source code (for example `[OA1]`). The Sources section maps each code to its URL. All pages were consulted on **2026-11-11**.
- Cell values: `yes`, `no`, `partial`, `?` (not confirmed in official docs, see Gaps).
- Provider names are Routerly provider ids. Providers that share Routerly's `CustomAdapter` (deepseek, groq, together, perplexity, xai, mistral, cohere, fireworks, cerebras) speak OpenAI-style Chat Completions. `gemini` and `ollama` use their OpenAI-compatible endpoints. `openai-web` and `anthropic-web` are out of scope.

## Standards considered

| Standard | Used by | Notes |
|---|---|---|
| OpenAI Chat Completions (`/v1/chat/completions`) | openai, azure-openai, gemini (compat), ollama (compat), deepseek, groq, together, perplexity, xai, mistral, cohere (compat), fireworks, cerebras | De facto baseline. Each provider is a subset or superset; see matrices. `[OA1]` |
| OpenAI Responses (`/v1/responses`) | openai-oauth (Codex backend); optional on openai, azure-openai, xai, groq | Items-based input/output, reasoning items, `function_call_output`. `[OA4]` `[OA2]` |
| Anthropic Messages (`/v1/messages`) | anthropic, anthropic-oauth (also vertex Claude models, bedrock Claude models) | Top-level `system`, user/assistant roles only, content blocks. `[AN1]` |
| Provider-native APIs | gemini (`generateContent`), bedrock (Converse), vertex (`generateContent`), ollama (`/api/chat`) | Used by Routerly adapters for bedrock and vertex. `[GE2]` `[BR1]` `[VX1]` |
| JSON Schema (tool `parameters`, `response_format`) | all | Every provider implements a subset; keyword support differs (matrix 1). Schema dialect: OpenAI, Anthropic, xAI, Cerebras, Azure use a JSON Schema subset; Gemini and Vertex use an OpenAPI-3.0 subset. `[OA2]` `[AN2]` `[XA2]` `[CB2]` `[AZ3]` `[GE2]` `[VX1]` |
| Server-Sent Events (WHATWG HTML living standard, `text/event-stream`) | all streaming except bedrock (AWS event stream framing, unconfirmed) | OpenAI-style streams end with `data: [DONE]`; Anthropic streams use named events. `[OA1]` `[AN4]` `[AN5]` |

The JSON Schema specification and the WHATWG SSE specification pages themselves were not fetched in this pass; only provider documentation was consulted. Treat provider docs as authoritative for what each provider accepts.

## Capability matrices

### 1. Tool parameter JSON Schema subset

Routerly forwards `tools[].function.parameters` (or the provider equivalent). "Strict" means constrained-decoding mode.

| Provider | Keyword handling | Limits / structural requirements | Source |
|---|---|---|---|
| openai | Non-strict (Chat Completions default): general JSON Schema. Strict: needs `additionalProperties:false` on every object and all properties in `required` (optionals use a null type). Full strict keyword list: ? | Responses API normalizes the schema and falls back to non-strict if it cannot. | `[OA2]` |
| openai-oauth | Responses API function tools: `strict` is boolean or null. Codex-backend specifics: ? | `function_call_output.output` string up to 10,485,760 chars. | `[OA4]` |
| anthropic / anthropic-oauth | Tool `input_schema` is JSON Schema. Strict/structured-output subset: supported types, enum, const, anyOf, allOf (not with `$ref`), internal `$ref`/`$defs`, default, required, formats (date-time, time, date, duration, email, hostname, uri, ipv4, ipv6, uuid), `minItems` 0 or 1, simple `pattern`. Unsupported: recursive schemas, external `$ref`, minimum/maximum/multipleOf, minLength/maxLength, other array constraints, complex enums. | `additionalProperties` must be `false`. Violations return 400. | `[AN2]` |
| gemini | OpenAPI-3.0 subset (`responseSchema`). Exact function-schema subset on the Gemini API: ? | | `[GE2]` |
| vertex | Allowed: type, nullable, required, format, description, properties, items, enum, anyOf, `$ref`, `$defs`. Other attributes unsupported. | 32 nesting levels; recursion through `$defs` limited to two levels. | `[VX1]` |
| ollama | Not documented. | | `[OL1]` |
| deepseek | Non-strict: no list. Strict (beta, base `https://api.deepseek.com/beta`): all properties required, `additionalProperties:false`; `pattern` and `format` supported; `minLength`, `maxLength`, `minItems`, `maxItems` not supported. | | `[DS3]` |
| groq | Keyword list not documented. | | `[GQ3]` |
| together | Keyword list not documented. | | `[TG1]` |
| perplexity | Not documented (Sonar function calling not confirmed). | | `[PX1]` `[PX2]` |
| xai | Tool `parameters` root must be `type:object` (root `anyOf`/`oneOf` allowed if every branch is an object); others rejected with 400 naming the tool. Structured-output list: supported types, enum, const, anyOf/oneOf, `allOf` with one subschema, `$ref`/`$defs` (non-circular), minLength/maxLength (up to 2,048), minItems/maxItems (up to 256), minProperties/maxProperties (up to 64), minimum/maximum/exclusive*, `pattern` (ECMAScript subset), `format` (date, time, date-time, email, uuid, ipv4, ipv6, uri). Rejected with 400: empty `enum`/`anyOf`, boolean property schemas, `minContains`/`maxContains`, array-form `items`. Best-effort: `not`, `if/then/else`, multi-`allOf`. | Max 350 tools per request; unique names. `additionalProperties` defaults to `false`. | `[XA1]` `[XA2]` |
| mistral | Each tool is `{type:function, function:{name,description,parameters}}`; keyword list and `strict`: not documented. | | `[MI2]` |
| cohere | `strict: true` on tools guarantees schema match; keyword list: not documented. | | `[CO1]` |
| fireworks | Types string/number/integer/object/array/boolean/null; `enum`, `required`; `$defs`/`definitions` + in-document `#/...` `$ref` incl. recursive; `$id`, `$schema`, annotations accepted; external `$ref` returns 400. Function name: letters, digits, `_`, `-`, max 64. `strict`: not mentioned. | | `[FW2]` |
| cerebras | Strict mode: supported types, enum, const (primitive), anyOf (non-root), local non-recursive `$ref`/`$defs`, `prefixItems` with `items:false`, minimum/maximum/exclusive*/multipleOf; annotations accepted. Unsupported: recursive, external `$ref`, `$anchor`, missing/`true`/array-form `items`, oneOf/allOf/not, `nullable`, if/then/else, dependent*, patternProperties, unevaluatedProperties, `pattern`, `format`, minItems/maxItems; minLength/maxLength unsupported on `qwen-3.8-27b`. | Root `type:object` with `properties`; `additionalProperties:false` on every object; arrays need `items` or `prefixItems`. Counted schema text 5,000 chars, depth 10, 500 properties, 500 enum values. `strict:false` is not enforced. | `[CB2]` `[CB3]` |
| azure-openai | Structured outputs/strict: string, number, boolean, integer, object, array, enum, anyOf (not at root). Unsupported: minLength, maxLength, pattern, format, minimum, maximum, multipleOf, patternProperties, unevaluatedProperties, propertyNames, minProperties, maxProperties, unevaluatedItems, contains, minContains, maxContains, minItems, maxItems, uniqueItems. `$defs` and recursion supported. | All fields required; `additionalProperties:false`; up to 100 properties and 5 nesting levels. Tool description max 1,024 chars. | `[AZ3]` `[AZ4]` |
| bedrock | `toolConfig.tools[].toolSpec.inputSchema.json` is JSON Schema; subset not documented in pages fetched. | `tools` min 1. | `[BR1]` |

### 2. Tool calling

| Provider | Parallel calls | `tool_choice` values | Tool result continuation | Source |
|---|---|---|---|---|
| openai | yes, `parallel_tool_calls` default true | none, auto, required, named function, allowed_tools | `role:tool` with `tool_call_id`. gpt-5.6: function tools on Chat Completions only with `reasoning_effort:none`; gpt-6 Astra / 6.1 Sol need Responses for tools. | `[OA1]` `[OA2]` |
| openai-oauth | yes (Responses) | Responses `tool_choice`: ? | `function_call_output` item with `call_id`. Reasoning items must be passed back with tool outputs. | `[OA2]` `[OA4]` |
| anthropic / anthropic-oauth | yes; `disable_parallel_tool_use` | auto, any, tool (named), none | `tool_result` content block in a user message. Manual thinking (`type:enabled`) allows only `auto` or `none`. | `[AN1]` `[AN3]` |
| gemini | ? | `auto` documented; others ? | ? | `[GE1]` |
| vertex | yes; parallel responses returned in one turn, in order | modes AUTO, VALIDATED, ANY (+`allowed_function_names`), NONE | function response parts in one turn; thought signatures returned unmodified | `[VX1]` |
| ollama | ? | `tool_choice` not supported | ? | `[OL1]` |
| deepseek | ? | `required` and named choice return 400 in thinking mode | `role:tool` | `[DS2]` `[DS1]` |
| groq | yes on some models (llama-3.3-70b-versatile, llama-3.1-8b-instant); not on `openai/gpt-oss` | ? | `role:tool` with `tool_call_id`, `name`, `content` string | `[GQ3]` |
| together | multiple calls per turn supported; parameter ? | ? | ? | `[TG1]` |
| perplexity | ? | ? | ? | `[PX2]` |
| xai | yes, default; `parallel_tool_calls:false` disables | auto, required, none, named function | Responses: `function_call_output` + `previous_response_id`. With streaming a call arrives in one chunk. | `[XA1]` |
| mistral | yes, `parallel_tool_calls` default true | auto, any, none | `role:tool` with `name`, `content`, `tool_call_id` | `[MI2]` |
| cohere | `parallel_tool_calls` unsupported in compat API | ? | `tool` messages with `tool_call_id` | `[CO1]` |
| fireworks | model-dependent; `parallel_tool_calls` not documented | none, auto, required, named function (no `any`) | `role:tool` with `tool_call_id` | `[FW2]` |
| cerebras | yes, default; `parallel_tool_calls:false` forces sequential | none, auto, required, named function | one `tool` message per call, `tool_call_id` | `[CB4]` |
| azure-openai | structured outputs not supported with parallel calls; parallel unsupported at effort `minimal` | auto, none, named | `tool` message, `tool_call_id`; `functions`/`function_call` deprecated | `[AZ2]` `[AZ3]` `[AZ4]` |
| bedrock | ? | `toolChoice` union; members ? | `toolResult` block; `stopReason` `tool_use`, also `malformed_tool_use` | `[BR1]` |

### 3. Reasoning / thinking

| Provider | Enable / disable | Pass-back requirement | Params unsupported while reasoning | Source |
|---|---|---|---|---|
| openai | `reasoning_effort`: none, minimal, low, medium, high, xhigh, max (model-dependent; GPT-6 Astra rejects `none` with 400) | Responses: reasoning items with tool outputs; `store:false` returns `encrypted_content`; reuse only within same model family | `max_tokens` (use `max_completion_tokens`, counts reasoning tokens); `stop` unsupported on o3 and o4-mini | `[OA1]` `[OA3]` |
| openai-oauth | `reasoning.effort`; `include:["reasoning.encrypted_content"]` for stateless use | Resend reasoning items; resend `phase` on assistant messages for gpt-5.3-codex and later | `max_output_tokens` includes reasoning | `[OA3]` `[OA4]` |
| anthropic / anthropic-oauth | `thinking:{type:enabled,budget_tokens}`; `thinking:{type:disabled}` where accepted | `thinking` / `redacted_thinking` blocks (with `signature` / `data`) passed back unmodified, required within a tool-use turn | Manual thinking: `tool_choice` only auto/none. Newer models (Opus 4.7/4.8, 5.x, Sonnet 5, Fable, Mythos, Haiku 5.5): non-default `temperature`/`top_p`/`top_k` return 400. Prefill rejected on 4.6+. | `[AN3]` `[AN1]` |
| gemini | OpenAI compat `reasoning_effort`: minimal/low -> low, medium, high; `none` disables only on 2.5; cannot disable on 2.5 Pro, Gemini 3, Gemini 4 | ? | ? | `[GE1]` |
| vertex | thinking config: ? | Thought signatures returned unmodified with function result; signed and unsigned parts not merged | ? | `[VX1]` |
| ollama | `reasoning_effort` / `reasoning.effort` on compat endpoint; native `think` true/false/level, output in `message.thinking` | ? | ? | `[OL1]` `[OL2]` |
| deepseek | `thinking` (on by default), then `reasoning_effort` | `reasoning_content` must be passed back when tools are present, otherwise 400 | `temperature`, `presence_penalty`, `frequency_penalty` have no effect; `required`/named `tool_choice` return 400 | `[DS1]` `[DS2]` |
| groq | `reasoning_effort` per model (Qwen 3.8 27B: none, default, low, medium, high; GPT-OSS: low, medium, high; Muse Spark Open: low..xhigh, cannot disable); `include_reasoning` (GPT-OSS) | Not stated | `reasoning_format` and `include_reasoning` mutually exclusive; `raw` format with JSON mode or tools returns 400; `reasoning_format` unsupported on GPT-OSS | `[GQ4]` |
| together | ? | ? | ? | - |
| perplexity | Sonar `reasoning_effort`: not confirmed. Agent API has `effort`. | ? | ? | `[PX3]` |
| xai | `reasoning_effort` low/medium/high/xhigh on grok-4.5+; default high; cannot be turned off | Responses only: send reasoning items back unchanged (`include:["reasoning.encrypted_content"]`); Chat Completions has no field for this | Reasoning models reject `presence_penalty`, `frequency_penalty`, `stop` | `[XA3]` |
| mistral | `reasoning_effort`: small/medium `none`/`high`; large-4 low/medium/high; GLM models low/high/max (no `none`) | Replay full assistant message including `ThinkChunk` (`type:"thinking"`); `content` becomes a chunk list | ? | `[MI3]` |
| cohere | `reasoning_effort` only `none` and `high` | ? | ? | `[CO1]` |
| fireworks | `reasoning_effort` low/medium/high, or `thinking:{type:enabled,budget_tokens>=1024}`; both together are a validation error | Include prior assistant `reasoning_content` in multi-turn tool calling; `reasoning_history:"preserved"` keeps earlier turns | ? | `[FW3]` |
| cerebras | `reasoning_effort` (values per model; `none` disables; unsupported on GPT OSS 120B, Kimi K3/K3.1 Pro, GLM 5.3 Flash); `reasoning_format` parsed/raw/hidden/none (`none` does not disable reasoning); output in `message.reasoning` / `delta.reasoning` | Kimi K3/K3.1 Pro: replay full assistant response incl. reasoning and tool calls; Qwen 3.8 27B / GLM 5.3 Flash: `clear_thinking` | Do not send `disable_reasoning`, `enable_thinking`, `thinking_budget`, `preserve_thinking`; `raw` with `json_*` formats unsupported on Kimi K2.7 Code | `[CB5]` |
| azure-openai | `reasoning_effort` | ? | temperature, top_p, presence_penalty, frequency_penalty, logprobs, top_logprobs, logit_bias, `max_tokens` unsupported; use `max_completion_tokens` (Responses: `max_output_tokens`) | `[AZ2]` |
| bedrock | model-specific via `additionalModelRequestFields` | `reasoningContent.reasoningText{text,signature}` / `redactedContent` and all previous messages must be sent back unchanged or the call errors | ? | `[BR1]` `[BR2]` |

### 4. System prompt forms

| Provider | Form | Multiple system messages | Source |
|---|---|---|---|
| openai | `developer` replaces `system` for o1 and newer; `system` still accepted on older models | ? | `[OA1]` |
| openai-oauth | Responses input roles user, system, developer | ? | `[OA4]` |
| anthropic / anthropic-oauth | Top-level `system`: string or array of text blocks; messages only user/assistant | single field (array of blocks) | `[AN1]` |
| gemini | native `systemInstruction`; compat role handling ? | ? | `[GE2]` |
| vertex | `systemInstruction` (not re-verified this pass) | ? | - |
| ollama | ? | ? | - |
| deepseek | roles system, user, assistant, tool | ? | `[DS2]` |
| groq | `developer` role: not mentioned in compat page | ? | `[GQ1]` |
| together / perplexity | ? | ? | - |
| xai | Chat Completions roles ?; Responses: `instructions` is alternate system prompt, cannot combine with `previous_response_id` | ? | `[XA4]` |
| mistral | System, User, Assistant, Tool messages; `developer` not listed | ? | `[MI1]` |
| cohere | compat: use `developer` role for system instructions | ? | `[CO1]` |
| fireworks | `role` documented as system, user, assistant (`tool` not listed in role enum though messages carry `tool_call_id`) | ? | `[FW1]` |
| cerebras | `developer` and `system` both map to a developer-level instruction layer (documented for `gpt-oss-120b`); `system` still supported | ? | `[CB1]` |
| azure-openai | `developer` is functionally the same as `system`; do not use both | do not combine | `[AZ2]` |
| bedrock | top-level `system`: array of `SystemContentBlock` | array of blocks | `[BR1]` |

### 5. Image input format

| Provider | Format | Source |
|---|---|---|
| openai | `image_url` part: URL or base64 data URI; `detail` auto/low/high/original | `[OA1]` |
| openai-oauth | Responses image input part (format not re-verified) | `[OA4]` |
| anthropic / anthropic-oauth | `image` block, source base64 (jpeg, png, gif, webp), url, or file | `[AN1]` |
| gemini | compat: base64 data URI | `[GE1]` |
| vertex | ? | - |
| ollama | compat: base64 only, no URLs | `[OL1]` |
| deepseek, together, perplexity, mistral | ? | - |
| groq | Responses API supports image input; Chat Completions details ? | `[GQ1]` |
| xai | ? (page fetched covered Responses only) | `[XA4]` |
| cohere | image input in compat API: not documented | `[CO1]` |
| fireworks | `image_url.url`: link, base64 data URI, or `mm_file://{file_id}`; optional `detail`, `max_long_side_pixel` | `[FW1]` |
| cerebras | base64 PNG or JPEG data URIs only; external HTTPS URLs unsupported | `[CB1]` |
| azure-openai | ? | - |
| bedrock | `image.source.bytes` base64 in raw REST; only Nova accepts an S3 URI | `[BR2]` |

### 6. Streaming SSE and usage reporting

| Provider | Wire format | Usage in stream | Source |
|---|---|---|---|
| openai | SSE, ends `data: [DONE]` | `stream_options.include_usage:true` adds a final chunk with empty `choices` before `[DONE]` | `[OA1]` |
| openai-oauth | Responses SSE events | ? | `[OA4]` |
| anthropic / anthropic-oauth | SSE with named events when `stream:true` | in stream events (details in streaming page) | `[AN4]` `[AN5]` |
| gemini | compat: `include_usage` used in examples; native `alt=sse`: not documented | `usageMetadata` (native) | `[GE1]` `[GE2]` |
| vertex | ? | ? | - |
| ollama | `stream_options` supports `include_usage` only | `include_usage` | `[OL1]` |
| deepseek | SSE | with `stream_options.include_usage`, usage on the last content chunk | `[DS2]` |
| groq | ? | ? | - |
| xai | Responses: data-only SSE ending `data: [DONE]` | response body `usage` incl. cost fields | `[XA4]` |
| mistral | ends `data: [DONE]`; `stream_options` not documented | ? | `[MI1]` |
| fireworks | SSE | usage on by default; final chunk with empty `choices` before `[DONE]`; `include_usage:false` opts out | `[FW1]` |
| cerebras | tool calls require `stream:true` (no `tool_stream`) | ? | `[CB1]` |
| together, perplexity, cohere, azure-openai | ? | ? | - |
| bedrock | ConverseStream events: messageStart, contentBlockStart, contentBlockDelta, contentBlockStop, messageStop, metadata; wire framing not confirmed | `metadata` event: inputTokens, outputTokens, totalTokens, cache fields | `[BR1]` `[BR2]` |

### 7. Unsupported or renamed parameters

| Provider | Facts | Source |
|---|---|---|
| openai | `max_tokens` deprecated, incompatible with o-series; use `max_completion_tokens`. `response_format`: text, json_schema, json_object. `stop` unsupported on o3/o4-mini. | `[OA1]` |
| openai-oauth | Responses: `max_output_tokens`; `store`, `include` per Responses reference | `[OA4]` |
| anthropic / anthropic-oauth | `max_tokens` required. Structured output via `output_config.format`. Sampling params restricted on newer models (see matrix 3). | `[AN1]` `[AN3]` |
| gemini | native `maxOutputTokens`; compat unsupported-param list not documented | `[GE2]` `[GE1]` |
| ollama | not supported: `tool_choice`, `logit_bias`, `user`, `n`, logprobs | `[OL1]` |
| deepseek | `max_tokens` 1-393216; `response_format` text or json_object only | `[DS2]` |
| groq | 400 on `logprobs`, `logit_bias`, `top_logprobs`, `messages[].name`; `n` must be 1; `temperature:0` becomes `1e-8` | `[GQ1]` |
| xai | Responses: no `frequency_penalty`/`presence_penalty`; `max_output_tokens` default 128,000, visible output only; `metadata`, `truncation` compat-only; `background` unsupported | `[XA4]` |
| mistral | `max_tokens`; `response_format` text/json_object/json_schema; `safe_prompt`, `prompt_mode:"reasoning"` extra | `[MI1]` |
| cohere | supported: model, messages, stream, response_format, tools, temperature, max_tokens, stop, seed, top_p, frequency_penalty, presence_penalty, reasoning_effort. Unsupported: store, metadata, logit_bias, top_logprobs, n, modalities, prediction, audio, service_tier, parallel_tool_calls | `[CO1]` |
| fireworks | `max_completion_tokens` is an alias of `max_tokens`, cannot set both; default `context_length_exceeded_behavior:truncate`; `response_format`: json_object, json_schema, grammar, text; `service_tier` only `priority`; `functions`/`function_call` converted to `tools`/`tool_choice` | `[FW1]` |
| cerebras | `n` only 1; `prediction` model-dependent; `service_tier` not on Developer Tier; `gpt-oss-120b` rejects `tools` with `response_format`; `reasoning_format`, `clear_thinking` go in `extra_body`; frequency/presence penalty, logit_bias, `max_completion_tokens`: not covered on page | `[CB1]` |
| azure-openai | reasoning models: `max_completion_tokens`, no `max_tokens`; `api-version` query on deployment URLs or v1 endpoint `https://RESOURCE.openai.azure.com/openai/v1/`; auth `api-key` header or Bearer | `[AZ1]` `[AZ2]` |
| bedrock | `inferenceConfig`: maxTokens, stopSequences, temperature, topP; anything else in `additionalModelRequestFields` | `[BR1]` |
| together, perplexity, vertex | ? | - |

### 8. Error shape and retryable statuses

| Provider | Body shape | Retry | Do not retry | Source |
|---|---|---|---|---|
| openai | `error.{code,type,param,message}` | 429 (rate limit, `slow_down`), 500, 503; honor `Retry-After` | 429 billing/spend, 401, 403 | `[OA5]` |
| anthropic | `{type:"error",error:{type,message},request_id}` | 429, 500, 504, 529 (backoff); 409 conflict | 400, 401, 402, 403, 404, 413 | `[AN4]` |
| gemini | JSON shape not documented | 408, 429, 5xx | 400, 402, 403 | `[GE3]` |
| deepseek | body shape not documented | 500, 503 | 400, 401, 402, 422 (429 listed separately) | `[DS4]` |
| groq | `error.{message,type}` | 429 (throttle), 500, 502, 503, 498 | 400, 401, 403, 404, 413 | `[GQ2]` |
| together | body shape not documented | 429, 503, 529 backoff; 500, 504, 524 brief wait | 400, 401, 403, 404, 413; 402 add credits | `[TG2]` |
| fireworks | only documented: 422 `{"detail":[{loc,msg,type,input,ctx}]}` | ? | ? | `[FW1]` |
| cerebras | body not defined; SDK errors | SDK retries connection errors, 408, 429, 5xx twice | other 4xx | `[CB6]` |
| bedrock | exception types: 400 Validation, 403 AccessDenied, 404 ResourceNotFound, 408 ModelTimeout, 424 ModelError, 429 Throttling / ModelNotReady, 500 InternalServer, 503 ServiceUnavailable | SDK auto-retries ModelNotReady (up to 5) | | `[BR1]` |
| ollama, perplexity, xai, mistral, cohere, azure-openai, vertex, openai-oauth | ? | ? | ? | see Gaps |

## Normalization rules derived

Each rule is the minimum change to avoid a documented rejection. Apply only when the request actually carries the offending field. Rules marked (gap) are not derivable from official docs and must not be added.

### openai
- Reasoning/o-series and newer: rename `max_tokens` to `max_completion_tokens`. `[OA1]`
- o3 and o4-mini: drop `stop`. `[OA1]`
- Non-strict function tools: no schema rewrite required. If `strict:true` is set: `additionalProperties:false` on every object and all properties in `required`. `[OA2]`
- System role: `system` to `developer` only for o1 and newer. `[OA1]`

### openai-oauth (Responses via Codex backend)
- Map `max_tokens` / `max_completion_tokens` to `max_output_tokens`. `[OA3]` `[OA4]`
- Keep reasoning items and `function_call_output.call_id` pairing on tool continuations; request `include:["reasoning.encrypted_content"]` for stateless use. `[OA2]` `[OA4]`
- Codex-backend restrictions: (gap).

### anthropic / anthropic-oauth
- System: lift `system`/`developer` messages into top-level `system`; messages only user/assistant. `[AN1]`
- Tool role messages become `tool_result` blocks in a user message. `[AN1]`
- `max_tokens` required. `[AN1]`
- Thinking on: pass back `thinking` and `redacted_thinking` blocks unmodified; with manual thinking restrict `tool_choice` to auto/none. `[AN3]`
- Newer models: drop non-default `temperature`/`top_p`/`top_k`. `[AN3]`
- Do not send assistant prefill on Claude 4.6 and later. `[AN1]`
- Strict schemas: drop minimum/maximum/multipleOf, minLength/maxLength, array constraints beyond `minItems` 0/1, external `$ref`; set `additionalProperties:false`. `[AN2]`

### gemini (OpenAI compat)
- `reasoning_effort`: `minimal` and `low` both mean low; `none` only on 2.5 (drop elsewhere). `[GE1]`
- Images: convert URLs to base64 data URIs. `[GE1]`
- Function-schema keyword drops: (gap).

### vertex
- Function declarations: keep only type, nullable, required, format, description, properties, items, enum, anyOf, `$ref`, `$defs`; limit nesting to 32 levels and recursion to two levels. `[VX1]`
- Return all parallel function responses in one turn, in order; return thought signatures unmodified. `[VX1]`

### ollama
- Drop `tool_choice`, `logit_bias`, `user`, `n`, logprobs. `[OL1]`
- Images: base64 only, no URLs. `[OL1]`
- `stream_options`: keep only `include_usage`. `[OL1]`

### deepseek
- Thinking mode: pass back `reasoning_content` on assistant turns when tools are present. `[DS1]`
- Thinking mode: drop `required`/named `tool_choice`. `[DS2]`
- `response_format`: only text/json_object. `[DS2]`
- Strict beta schemas: drop minLength, maxLength, minItems, maxItems; all properties required. `[DS3]`

### groq
- Drop `logprobs`, `logit_bias`, `top_logprobs`, `messages[].name`; force `n` to 1 if set. `[GQ1]`
- Do not send `reasoning_format:raw` with tools or JSON mode; do not send `reasoning_format` with `include_reasoning`; no `reasoning_format` on GPT-OSS. `[GQ4]`
- GPT-OSS: no parallel tool use. `[GQ3]`

### together
- Only documented: error retry classes. Schema, reasoning, role rules: (gap).

### perplexity
- (gap) Chat Completions (Sonar) support ends 2026-09-27 per migration page; Agent API uses `input`/`output` and `effort`. `[PX3]`

### xai
- Reasoning models: drop `presence_penalty`, `frequency_penalty`, `stop`. `[XA3]`
- Tool `parameters`: root must be `type:object`. Drop `minContains`/`maxContains`, boolean property schemas, array-form `items`, empty `enum`/`anyOf`. `[XA1]` `[XA2]`
- Cap tools at 350. `[XA1]`
- Reasoning continuity only through Responses reasoning items. `[XA3]`

### mistral
- `tool_choice`: map `required` to `any`. `[MI2]`
- Reasoning: replay `ThinkChunk` in assistant history unchanged. `[MI3]`
- `reasoning_effort` none/high only for small/medium models. `[MI3]`

### cohere
- Drop `store`, `metadata`, `logit_bias`, `top_logprobs`, `n`, `modalities`, `prediction`, `audio`, `service_tier`, `parallel_tool_calls`. `[CO1]`
- `reasoning_effort`: only `none` or `high`. `[CO1]`
- System: `developer` role. `[CO1]`

### fireworks
- Do not send `thinking` together with `reasoning_effort`. `[FW3]`
- Do not send `max_tokens` together with `max_completion_tokens`. `[FW1]`
- Pass back `reasoning_content` on assistant tool-calling turns. `[FW3]`
- No `any` tool_choice; use `required`. `[FW2]`

### cerebras
- Strict tool schemas: drop oneOf/allOf/not, `pattern`, `format`, minItems/maxItems, `nullable`, if/then/else; `additionalProperties:false`; add `items` to arrays. `[CB3]`
- `n` must be 1. Images must be base64 PNG/JPEG data URIs. `[CB1]`
- Do not send `tools` with `response_format` on `gpt-oss-120b`. `[CB1]`
- Do not send `disable_reasoning`, `enable_thinking`, `thinking_budget`, `preserve_thinking`. `[CB5]`

### azure-openai
- Reasoning deployments: `max_tokens` to `max_completion_tokens`; drop temperature, top_p, presence_penalty, frequency_penalty, logprobs, top_logprobs, logit_bias. `[AZ2]`
- Do not send both `system` and `developer`. `[AZ2]`
- Strict schemas: drop minLength, maxLength, pattern, format, minimum, maximum, multipleOf, minItems, maxItems, uniqueItems and the other keywords listed in matrix 1. `[AZ3]`
- Replace deprecated `functions`/`function_call` with `tools`/`tool_choice`. `[AZ4]`

### bedrock (Converse)
- System prompt as `system: [{text}]`; sampling params into `inferenceConfig`; other model fields into `additionalModelRequestFields`. `[BR1]`
- Reasoning: return `reasoningContent` (with signature) and all prior messages unchanged. `[BR1]`

## Gaps and unconfirmed items

Not confirmable from the official pages fetched. Do not encode as rules.

1. OpenAI: full strict-mode keyword list (guide page truncated); Responses `tool_choice`, `parallel_tool_calls`, `store` details.
2. openai-oauth: the Codex backend is not documented in the public API reference; all lane-specific restrictions unknown.
3. Gemini: JSON error shape; `alt=sse` framing; OpenAI-compat unsupported-parameter list; `tool_choice` values beyond `auto`; function-schema keyword subset on the Gemini API; system role handling in compat.
4. Vertex: error shape and retry classes; system instruction, image, streaming and thinking-config details; Claude-on-Vertex specifics.
5. Bedrock: `toolChoice` members per model; event-stream framing; per-model reasoning and system support; tool `inputSchema` keyword subset (`tool-use-inference-call.html` fetch returned no usable documentation content and was discarded).
6. Together: reasoning, tool_choice values, strict/schema limits, roles, images, streaming usage, error body shape. The `error-codes` URL used first returned 404; the status-code table in `[TG2]` comes from the alternate page that was fetched.
7. Perplexity: roles, tools on Sonar Chat Completions, `response_format` limits, image input, stream usage, error shape, `reasoning_effort`.
8. xAI: Chat Completions details (roles, `max_tokens` vs `max_completion_tokens`, `stream_options`, images, errors); the page fetched covered Responses.
9. Mistral: `stream_options`, image parts, thinking chunks in stream, unsupported OpenAI params, 422 error shape, `strict` tools.
10. Cohere: error shape and retry classes (`docs.cohere.com/docs/errors` returned 404); `tool_choice`; image input.
11. Azure: SSE specifics, error JSON shape, image input.
12. DeepSeek and Ollama: error body shape; Ollama system role and thinking pass-back.
13. Groq: `developer` role, `tool_choice`, `strict`, image format, stream usage.
14. Fireworks: error shape beyond 422; `parallel_tool_calls`; `strict`.
15. Cerebras: error body schema; penalties, `logit_bias`, `max_completion_tokens` (page says "not covered").
16. JSON Schema and WHATWG SSE specification pages were not fetched.
17. Multiple system messages: only Azure ("do not use both") and Anthropic (single field) are documented; other providers unknown.

## Sources

All consulted 2026-11-11. Redirects were followed to the host shown.

| Code | URL |
|---|---|
| OA1 | https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create |
| OA2 | https://developers.openai.com/api/docs/guides/function-calling |
| OA3 | https://developers.openai.com/api/docs/guides/reasoning |
| OA4 | https://developers.openai.com/api/reference/resources/responses/methods/create |
| OA5 | https://developers.openai.com/api/docs/guides/error-codes |
| AN1 | https://platform.claude.com/docs/en/api/messages |
| AN2 | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| AN3 | https://platform.claude.com/docs/en/build-with-claude/thinking |
| AN4 | https://platform.claude.com/docs/en/api/errors |
| AN5 | https://platform.claude.com/docs/en/build-with-claude/streaming |
| GE1 | https://aistudio.google.com/docs/openai |
| GE2 | https://aistudio.google.com/api-reference/generate-content |
| GE3 | https://aistudio.google.com/docs/troubleshooting |
| VX1 | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling |
| OL1 | https://docs.ollama.com/api/openai-compatibility |
| OL2 | https://docs.ollama.com/capabilities/thinking |
| DS1 | https://api-docs.deepseek.com/guides/thinking_mode |
| DS2 | https://api-docs.deepseek.com/api/create-chat-completion |
| DS3 | https://api-docs.deepseek.com/guides/tool_calls |
| DS4 | https://api-docs.deepseek.com/quick_start/error_codes |
| GQ1 | https://console.groq.com/docs/openai |
| GQ2 | https://console.groq.com/docs/errors |
| GQ3 | https://console.groq.com/docs/tool-use |
| GQ4 | https://console.groq.com/docs/reasoning |
| TG1 | https://docs.together.ai/docs/function-calling |
| TG2 | https://docs.together.ai/docs/error-codes (first fetch 404; table taken from the alternate page returned by the later fetch, URL not recorded) |
| PX1 | https://docs.perplexity.ai/docs/getting-started/overview |
| PX2 | https://docs.perplexity.ai/api-reference/chat-completions-post |
| PX3 | Perplexity migration page reached from PX1 (URL not recorded) |
| XA1 | https://docs.x.ai/docs/guides/function-calling |
| XA2 | https://docs.x.ai/docs/guides/structured-outputs |
| XA3 | https://docs.x.ai/docs/guides/reasoning |
| XA4 | https://docs.x.ai/docs/api-reference |
| MI1 | https://docs.mistral.ai/api/endpoint/chat |
| MI2 | https://docs.mistral.ai/capabilities/function_calling/ |
| MI3 | https://docs.mistral.ai/capabilities/reasoning/ |
| CO1 | https://docs.cohere.com/docs/compatibility-api |
| FW1 | https://docs.fireworks.ai/api-reference/post-chatcompletions |
| FW2 | https://docs.fireworks.ai/guides/function-calling |
| FW3 | https://docs.fireworks.ai/guides/reasoning |
| CB1 | https://inference-docs.cerebras.ai/resources/openai |
| CB2 | https://inference-docs.cerebras.ai/capabilities/structured-outputs |
| CB3 | https://inference-docs.cerebras.ai/capabilities/structured-outputs (strict keyword list) |
| CB4 | https://inference-docs.cerebras.ai/capabilities/tool-use |
| CB5 | https://inference-docs.cerebras.ai/capabilities/reasoning |
| CB6 | https://inference-docs.cerebras.ai/support/error |
| AZ1 | https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference |
| AZ2 | https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning |
| AZ3 | https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/structured-outputs |
| AZ4 | https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/function-calling |
| BR1 | https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html |
| BR2 | https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html |
