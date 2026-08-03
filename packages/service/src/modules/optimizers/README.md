# Optimizers

Runtime prompt/context optimizers registered into `OPTIMIZER_REGISTRY` (see
`registry.ts` for the `Optimizer` contract and `core.ts` for the
`request.preprocess` pipeline step that applies them).

## session-dedup

`session-dedup` (id `'session-dedup'`, klass `'lossless'`) is an exact-match
deduplication pass. When the same message, by full structural equality
(role, content, tool-call fields, matched via `JSON.stringify`, not a
text-only comparison), repeats 3 or more times in a row, the middle repeats
are dropped and the first and last occurrence are kept. Structural, not
textual, matching is deliberate: a text-only key would collapse messages that
differ only in an image or tool-call payload, breaking wire-format
transparency. Near-duplicate or semantically-similar (not exact) messages are
untouched. That is `relevance`'s job.

## ccr

`ccr` (id `'ccr'`, klass `'recoverable'`) is a window-keep conversation
context reducer. It keeps the leading system prefix and the last N turns
(default 3, via the step's `threshold`), condenses everything older into a
single compact text block (each condensed message clipped to ~200 characters)
under a `[Condensed earlier context]` header, and merges that block into the
first kept message rather than inserting it as a separate message. No LLM
summarizer call is made. A tool-use / tool-result pair is never split across
the window cut.

The condensed block costs a header plus one role prefix per condensed message,
so when no older message exceeds the ~200 character clip there is nothing to
gain and the rewrite would produce a longer prompt. `ccr` detects that and
returns the original untouched: the step reports `changed: false` rather than a
negative saving.

## rtk

`rtk` (id `'rtk'`, klass `'recoverable'`) is a clean-room, rule-based token
compaction pass. It collapses redundant whitespace (runs of spaces/tabs, and
runs of blank lines) and strips repeated boilerplate/scaffolding paragraph
blocks (e.g. duplicated round-trip framing text) from each message's own text
content. It never drops, reorders, or merges messages, and never touches
non-text content parts (images, `tool_use`, `tool_result` blocks) — only the
density of a message's own text changes.

Provenance: this is an original, clean-room implementation written for this
codebase. No third-party code or dataset was copied or adapted, and no
license or provenance claim is made about any external project or technique.
The name `rtk` denotes only this optimizer's internal id within Routerly's
optimizer registry.

## headroom

`headroom` (id `'headroom'`, klass `'lossless'`) trims the oldest whole turns
until the request fits inside the context window of the model the client asked
for, minus a reserved completion headroom (default 1024 tokens, via the step's
`threshold`). It never re-summarizes dropped content, that is `ccr`'s job.

The window is resolved from `ctx.request.model` against the effective model
list, held in a 30-second cache because `supports()` is synchronous and
`listEffectiveModels()` is not. The first request after boot (or after a
`resetContextWindowCache()`) sees a cold cache and skips the step once.

It used to read `ctx.attempt?.model?.contextWindow` instead. `optimizer.apply`
runs in `request.preprocess`; `ctx.attempt` is assigned two phases later,
inside the `routing.execute` candidate loop, so `supports()` always returned
false and the step had **never fired on any install**.

The trim is sized for the requested model, not for whichever model routing
ends up picking. A policy can send the request elsewhere, so the result may
leave more history than a smaller fallback would accept; it can never trim
more than the requested model needs. The step is inert when the requested
model is unknown to the effective list or declares no window. Preview takes a
`model` for exactly that reason: without one the sample is addressed to no
model and this step reports why instead of trimming.

## json-table

`json-table` (id `'json-table'`, klass `'recoverable'`) rewrites a long JSON
array of uniform flat objects as a header line plus one line per row, values
separated by ` | `, under a `[Compacted JSON table]` header. Every value
survives byte-for-byte: only the repeated key names and the JSON punctuation
go. Long uniform arrays are where the tokens sit in coding-agent and RAG
traffic, and no other step touches them.

It only rewrites a message that is *nothing but* a JSON array, which is how a
tool result actually arrives (`contentKind()` decides). It stays inert on a
ragged array, on rows carrying a nested value, on any value containing `|` or a
newline, on arrays shorter than the step's `threshold` (default 5 rows), and
whenever the table would not be shorter than the JSON it replaces.

## relevance

`relevance` (id `'relevance'`, klass `'lossy'`) scores each older turn's
lexical overlap (Jaccard similarity of lowercase word sets) against the
newest turn and drops whole turns scoring below the step's `threshold`
(default `0.1`, from the shared catalog: enabling the step is the whole opt-in,
no second number is required). The newest turn is never
scored and is always kept. This is a lexical, not semantic, heuristic;
embedding-based scoring is a possible future upgrade if lexical overlap
proves too blunt, not built speculatively today.

## caveman

`caveman` (id `'caveman'`, klass `'lossy'`) is a clean-room, rule-based
lexical compression pass. It strips a small English function-word / filler
list (articles, conjunctions, prepositions, pronouns, auxiliaries, hedges)
from each message's own plain text and collapses the whitespace the removals
leave behind, keeping content words. It never drops, reorders, or merges
messages, and never touches non-text content parts (images, `tool_use`,
`tool_result` blocks) — only the density of a message's own text changes.

`caveman` is English-only by design. Its word list is 90 English function
words; on Italian it removed 1.0 percent of tokens and every removal was an
Italian word that happens to be spelled like an English one. `supports()`
therefore measures the share of words already in the list and returns false
below 0.12 (English measures 0.46, Italian 0.026), so the optimizer stays inert
on any other language. There is no language-detection dependency: the list is
its own detector. `llmlingua-2` is the multilingual step. Texts under 20 words
are not gated, because the ratio carries no signal there.

It is also prose-only. `contentKind()` in `messages.ts` classifies each
message's text and the strip returns anything that is not `prose` untouched: a
bare JSON payload (whole-text parse) or a message dominated by fenced code. A
pasted payload is not a protected span, so an object key that happens to be a
function word used to be stripped to nothing and `{"is":true}` came out as
`{"":true}`. The classification is per message, so prose sitting next to a
payload is still compressed.

Preserved verbatim, unconditionally, even under aggressive compression:
fenced code blocks (```` ``` ````), inline code spans (`` ` ``), URLs
(`http`/`https`), compound tokens whose parts are joined by `/`, `.` or `-`
(file paths such as `docs/concepts/on-call.md`, dotted identifiers such as
`config.is.enabled`, hyphenated compounds), and digit sequences. These regions are matched out before
stripping and re-joined byte-for-byte; digit-bearing tokens are never matched
by the word regex, so numbers survive intact. As a lossy optimizer, its
result is additionally checked by the shared floor-ratio safety gate (core.ts
/ gate.ts): over-compression is rejected and rolled back.

Provenance: this is an original, clean-room implementation written for this
codebase. The stopword/filler list is written from scratch inline; no
third-party code, dataset, or wordlist was copied or adapted, and no license
or provenance claim is made about any external project, product, or
technique. The name `caveman` denotes only this optimizer's internal id
within Routerly's optimizer registry.

## llmlingua-2

`llmlingua-2` (id `'llmlingua-2'`, klass `'lossy'`) is a token-level prompt
compression pass backed by a real, named, third-party model. The text is
tokenized with the model's own tokenizer, a token-classification head emits a
keep/discard pair of logits per position, and the top `threshold` fraction
(default `0.5`) of positions survive in their original order and are decoded
back through the same tokenizer. It never drops, reorders, or merges messages,
and never touches non-text content parts (images, `tool_use`, `tool_result`):
only a message's text density changes. As a lossy optimizer its result is
additionally checked by the shared floor-ratio safety gate (core.ts / gate.ts).

Nothing in the code path is language-specific. The multilinguality comes from
the encoder's own vocabulary and weights, not from any word list anyone has to
write or maintain, which is why this and not `caveman` is the step to use on
non-English prompts.

Unlike `rtk` and `caveman`, this is NOT a clean-room implementation: it wraps an
external model.

Provenance:

- Technique / reference code: `microsoft/LLMLingua`,
  https://github.com/microsoft/LLMLingua, MIT license.

The curated list lives in `packages/shared` as `LLMLINGUA_CHECKPOINTS`, so
the service, the CLI and the dashboard all name the same three keys:

| Key | Repo, dtype | Size | License |
|---|---|---|---|
| `bert-multilingual-q8` (default) | `ldenoue/llmlingua-2-bert-base-multilingual-cased-meetingbank`, `q8` | 182 MB | The export repo declares no license on its model card; the upstream `microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank` weights it exports are Apache-2.0 |
| `xlm-roberta-large-int8` | `atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank`, `int8` | 579 MB | MIT. Higher quality, heavier on disk and at inference. The one to pick when a declared license is required |
| `bert-multilingual-fp32` | Same repo as the default, `fp32` | 713 MB | As the default |

Which key a step runs on is the step's own `model` field, validated against
those keys (`schemas.ts`) and read by `modelKeyOf()`. The bytes are shared:
one host cache, one download per key, whatever mix of projects names it.

`ROUTERLY_LLMLINGUA_MODEL` / `ROUTERLY_LLMLINGUA_DTYPE` publish one extra
`custom` checkpoint from a raw repo id and make it the host's default. It is
deployment configuration, deliberately env-only: it writes files to this
host's disk, which is not a per-project decision. `checkpointStates()`
reports `isDefault` for that reason, so no surface re-derives a fallback the
env can move.

Checkpoints are cached under `<ROUTERLY_HOME>/models/<repo>/`, in the layout
transformers.js expects (`tokenizer.json` at the root, ONNX graphs under
`onnx/`, one file per dtype, which is how two dtypes of one repo are told
apart on disk). Nothing is auto-downloaded on install or at request time:
loading is `local_files_only`, so a proxied request can never trigger a
download. A download is started explicitly through `POST
/api/optimizers/llmlingua2/model` (`optimizers:manage`, optional `key`),
which returns 202 immediately; progress is polled from `GET
/api/optimizers/llmlingua2/model` (`optimizers:read`), exposed as `routerly
optimizers model [--install [key]]` and, in the dashboard, inside the
llmlingua-2 row itself, which is also where the step's checkbox stays
disabled until a checkpoint is ready. With no checkpoint cached and the
optional dependency not installed, the default state, the optimizer still
self-registers but `supports()` always returns false, so it is a no-op.

The `@huggingface/transformers` package is declared in
`packages/service/package.json` under `optionalDependencies`: it brings the
tokenizer and the ONNX runtime together (`onnxruntime-node` arrives as its own
dependency), and it is imported lazily inside a try/catch so its absence never
crashes module load or the service.
