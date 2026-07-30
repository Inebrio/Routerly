# Optimizers

Runtime prompt/context optimizers registered into `OPTIMIZER_REGISTRY` (see
`registry.ts` for the `Optimizer` contract and `core.ts` for the
`request.preprocess` pipeline step that applies them).

## session-dedup

`session-dedup` (id `'session-dedup'`, klass `'lossless'`) is an exact-match
deduplication pass. When the same message — by full structural equality
(role, content, tool-call fields, matched via `JSON.stringify`, not a
text-only comparison) — repeats 3 or more times in a row, the middle repeats
are dropped and the first and last occurrence are kept. Structural, not
textual, matching is deliberate: a text-only key would collapse messages that
differ only in an image or tool-call payload, breaking wire-format
transparency. Near-duplicate or semantically-similar (not exact) messages are
untouched — that is `relevance`'s job.

## ccr

`ccr` (id `'ccr'`, klass `'recoverable'`) is a window-keep conversation
context reducer. It keeps the leading system prefix and the last N turns
(default 6, via the step's `threshold`), condenses everything older into a
single compact text block (each condensed message clipped to ~200 characters)
under a `[Condensed earlier context]` header, and merges that block into the
first kept message rather than inserting it as a separate message. No LLM
summarizer call is made. A tool-use / tool-result pair is never split across
the window cut.

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
until the request fits inside the target model's context window minus a
reserved completion headroom (default 1024 tokens, via the step's
`threshold`). It never re-summarizes dropped content — that is `ccr`'s job.

Known limitation: `headroom` reads the target context window from
`ctx.attempt?.model?.contextWindow`, which is only populated once the routing
engine resolves a candidate model — a step that runs **after** the
`request.preprocess` pipeline phase where all optimizers execute. On a real
request `ctx.attempt` is not yet set, so `headroom`'s `supports()` check
never sees a context window and the optimizer is a **permanent no-op in
production** today, even though its trim logic is correct and fully covered
in isolation by its own tests. See [Concepts:
Optimizers](../../../../../docs/concepts/optimizers.md#headroom) and
[Service: Routing
Engine](../../../../../docs/service/routing-engine.md#optimizers-and-context-window-fit)
for the full explanation and the pipeline-ordering fix this depends on.

## relevance

`relevance` (id `'relevance'`, klass `'lossy'`) scores each older turn's
lexical overlap (Jaccard similarity of lowercase word sets) against the
newest turn and drops whole turns scoring below the step's `threshold`.
Unlike `ccr`/`headroom`, there is no built-in default threshold — `relevance`
stays inert until a project explicitly sets one. The newest turn is never
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

Preserved verbatim, unconditionally, even under aggressive compression:
fenced code blocks (```` ``` ````), inline code spans (`` ` ``), URLs
(`http`/`https`), and digit sequences. These regions are matched out before
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
compression pass backed by a real, named, third-party ONNX model. It scores
each token of a message's own text with the model's keep/discard classification
head and drops the lowest-scoring tokens down to a target keep-ratio (the step's
`threshold`, default `0.5`). It never drops, reorders, or merges messages, and
never touches non-text content parts (images, `tool_use`, `tool_result`) — only
a message's text density changes. As a lossy optimizer its result is
additionally checked by the shared floor-ratio safety gate (core.ts / gate.ts).

Unlike `rtk` and `caveman`, this is NOT a clean-room implementation: it wraps a
license-verified external model.

Provenance and license (both MIT, confirmed from source):

- Technique / reference code: `microsoft/LLMLingua`,
  https://github.com/microsoft/LLMLingua — MIT license.
- ONNX-usable model checkpoint:
  `microsoft/llmlingua-2-xlm-roberta-large-meetingbank`,
  https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank —
  MIT license (confirmed on the model card).

Model download is optional and gated — never auto-downloaded on install or at
first request; it requires explicit operator opt-in (`downloadModel(true)`) and
lands at a fixed on-disk path (`<ROUTERLY_HOME>/models/llmlingua-2/model.onnx`).
With no checkpoint on disk and the optional dependency not installed — the
default state — the optimizer still self-registers into the registry but
`supports()` always returns false, so it is a permanent no-op.

The `onnxruntime-node` package is declared in `packages/service/package.json`
under `optionalDependencies` because native ONNX inference has no pure-JS
equivalent of comparable quality; it is imported lazily inside a try/catch so
its absence never crashes module load or the service.
