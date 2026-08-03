---
"@routerly/service": minor
"@routerly/shared": minor
"@routerly/dashboard": minor
"@routerly/cli": minor
---

Optimizer overhaul.

Removed: the in-memory traffic-sample buffer, the
`GET /api/projects/:id/optimizers/samples` route, and `routerly optimizers
samples`. Real prompts were buffered per project and served to any holder of
`optimizers:read`. Synthetic fixtures replace them as preview material:
`support-chat-en`, `agent-tools-en`, `brief-en` and `long-context-en`, listed
by `routerly optimizers fixtures` and offered by the dashboard preview box.

Fixed: `headroom` never fired. It read the context window off the routing
attempt, which does not exist yet when the step runs, so it declared itself
unsupported on every request since it shipped. It now resolves the window from
the model named in the request, cached for 30 seconds. Routing may pick a
different model than the one requested, so the trim can be more generous than
needed, never more aggressive; an unknown model leaves the step inert.

Added: `json-table`, an eighth optimizer that rewrites long uniform JSON arrays
as a header row plus value rows.

Changed: `ccr` keeps 3 recent turns by default instead of 6; `relevance`
defaults to an overlap of 0.1 instead of staying inert.

Fixed: `caveman` no longer destroys unquoted file paths, dotted identifiers or
bare JSON payloads, and it no longer strips non-English text with an English
word list. It is the rule-based English step and now stays inert elsewhere.

Fixed: `llmlingua-2` produced meaningless output. It fed the ONNX session
pseudo-random ids from a local hash instead of the checkpoint's vocabulary, and
split text on whitespace instead of tokenizing it. It now loads the model
through `@huggingface/transformers`, which replaces the `onnxruntime-node`
optional dependency, and compresses any language the multilingual encoder
covers.

Added: three installable `llmlingua-2` checkpoints instead of one unreachable
default, from 182 MB at 8-bit to 713 MB at full precision, downloaded on the
service host and shared by every project. Which one a project runs on is a
property of its step: `--checkpoint` on the CLI, a picker in the dashboard
row, `model` on the step in the API. `ROUTERLY_LLMLINGUA_MODEL` and
`ROUTERLY_LLMLINGUA_DTYPE` still publish a custom one and make it the default.

Added: `GET` and `POST /api/optimizers/llmlingua2/model`, `routerly optimizers
model [--install [key]]`, and the same download inside the dashboard's
llmlingua-2 row, with a progress bar that survives a page refresh and a
checkbox that stays disabled until a checkpoint is ready. The checkpoint had
no installation path at all before this.

Added: a `model` on `POST /api/optimizers/preview` and `routerly optimizers
preview --model`, so context-window steps have a window to size against in a
dry run.

Added: every step reports why it did nothing, in the trace, the preview API,
the dashboard and the CLI.

Fixed: saving a pipeline that included `json-table` was rejected with
"Invalid optimizers config", because the API's step-id enum had not been
extended with the new id.
