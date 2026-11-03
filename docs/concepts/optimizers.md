---
title: Optimizers
sidebar_position: 8
---

# Optimizers

Optimizers reduce the token footprint of a request's message array before it
is forwarded to a provider. They run per-router, in a configurable pipeline,
and are **off by default**. A router must explicitly enable each optimizer
id it wants.

Routerly ships 8 built-in optimizers. Each declares a **class** that
determines how strictly its output is checked before being accepted:

| Class | Meaning |
|-------|---------|
| `lossless` | No information is discarded, messages are only deduplicated or trimmed to a fixed budget. Own `validate()` backstop only (skips the safety gate below). |
| `recoverable` | Content is condensed or compacted but a pre-optimize snapshot is kept; a failed `validate()` rolls back to the original. |
| `lossy` | Content is deliberately dropped or compressed. In addition to `validate()`, every `lossy` result is checked by the shared **safety gate** before being accepted. |

---

## The 8 Optimizers

### session-dedup

`id: session-dedup`, class `lossless`.

Exact-match deduplication: when the same message (by full structural
equality, role, content, tool-call fields) repeats 3 or more times in a
conversation, the middle repeats are dropped and the first and last
occurrence are kept. Messages are never partially edited.

This is exact-match only. Near-duplicate or semantically-similar messages
are not touched. That is the `relevance` optimizer's job.

### ccr (Conversation Context Reduction)

`id: ccr`, class `recoverable`.

Keeps the leading system prefix and the last N turns (default 3, via the
step's `threshold`). Older turns are condensed into a single compact text
block (per-message text clipped to ~200 characters) and merged into the
first kept message. No LLM summarizer call is made. A tool-use /
tool-result pair is never split across the window cut.

### rtk (Redundant Token Killer)

`id: rtk`, class `recoverable`.

Rule-based text compaction, applied per message: collapses redundant
whitespace (runs of spaces/tabs, runs of blank lines) and strips repeated
boilerplate paragraph blocks within a message. Never drops, reorders, or
merges messages, and never touches non-text content parts (images,
`tool_use`, `tool_result`).

### headroom

`id: headroom`, class `lossless`.

Trims the oldest whole turns until the request fits inside the context
window of the model the request names, minus a reserved completion headroom
(default 1024 tokens, via the step's `threshold`). No re-summarization, that
is `ccr`'s job.

The window comes from the **requested** model, resolved through the
effective model list and cached for 30 seconds. It cannot come from the
routing attempt: optimizers run in `request.preprocess`, two phases before a
candidate model exists. That is exactly what kept this step inert on every
request before 0.4.0.

Two consequences follow from reading the requested model:

- **Routing may land elsewhere.** If the request names a 32k model and the
  router picks a 200k one, the prompt was trimmed to fit 32k. The trim can
  therefore be more generous than needed, never more aggressive than the
  model that actually serves the call can take.
- **An unknown model leaves the step inert.** A model id Routerly has no
  window for (unnamed, not in the model list, or declaring no
  `contextWindow`) means no budget, so the step does nothing and says so in
  its skip reason.

### json-table

`id: json-table`, class `recoverable`.

Rewrites a message that is a JSON array of uniform flat objects (default 5
rows or more, via the step's `threshold`) as one header line plus one line
per row, values separated by ` | `. Every value survives: only the repeated
key names and the JSON punctuation go. Ragged arrays, nested values, and
values containing `|` or a newline are left alone, as is anything shorter
than the threshold, where the header costs more than it saves.

This targets tool results, which arrive as their own message. Arrays
embedded inside prose are not scanned.

### relevance

`id: relevance`, class `lossy`.

Scores each older turn's lexical overlap (Jaccard similarity of lowercase
word sets) against the newest turn and drops whole turns scoring below the
step's `threshold` (default 0.1). The newest turn is never scored and always
kept.

This is a lexical, not semantic, heuristic. It may be upgraded to
embedding-based scoring if lexical overlap proves too blunt in practice;
not built speculatively today.

### caveman

`id: caveman`, class `lossy`.

Clean-room lexical compression: strips a small English filler-word list
(articles, conjunctions, prepositions, pronouns, auxiliaries, hedges) from
each message's own plain text and collapses the resulting whitespace.
Fenced code blocks, inline code spans, URLs, file paths, dotted identifiers,
bare JSON payloads and digit sequences are preserved verbatim,
unconditionally, even under aggressive stripping. Messages are never
dropped, reordered, or merged, and non-text content parts are never touched.

English only. Below roughly 12% English function words the step declines to
run rather than shredding text it has no word list for. See
[Languages](#languages).

### llmlingua-2

`id: llmlingua-2`, class `lossy`.

Token-level prompt compression backed by a real, named, third-party model:
the technique from [`microsoft/LLMLingua`](https://github.com/microsoft/LLMLingua)
(MIT license), running an ONNX export of the LLMLingua-2 token classifier
through [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers).
Each token of a message's own text is scored by the model's keep/discard
head; the lowest-scoring tokens are dropped down to a target keep-ratio (the
step's `threshold`, default `0.5`). Tokenization is the checkpoint's own, so
the ids the model scores are the ids it was trained on.

A message longer than the encoder's 512-token window is scored one window at
a time and the scores concatenated, so length is not a ceiling: the longest
prompts, which are the ones worth compressing, are compressed too.

The step rolls itself back whenever any message comes out longer in
characters than it went in. Decoding a subset of subword tokens re-inserts
spaces between them, so on messages that tokenize into many short pieces
(dense JSON, tool results) a high keep-ratio can cost more characters than it
saves. Lower the threshold if a step reports no change on payload-heavy
prompts.

It is multilingual: it compresses any language the encoder covers, which is
why it, not `caveman`, is the step to reach for outside English.

Off by default in two independent ways:

- `@huggingface/transformers` is declared an **optional dependency**
  (`packages/service/package.json`), not installed by default, and imported
  lazily inside a try/catch.
- No checkpoint is ever auto-downloaded. An operator installs one
  explicitly. Until one is on disk the optimizer still self-registers into
  the catalog (so `GET /api/optimizers` lists it), but `supports()` returns
  `false` and the step is skipped on every request. A proxied request never
  downloads anything.

#### Checkpoints

Three checkpoints are published. They are a curated list: a request naming
anything else is refused rather than fetched, since fetching is what costs
the disk.

| Key | Model | Size | License | When to pick it |
|-----|-------|------|---------|-----------------|
| `bert-multilingual-q8` | [`ldenoue/llmlingua-2-bert-base-multilingual-cased-meetingbank`](https://huggingface.co/ldenoue/llmlingua-2-bert-base-multilingual-cased-meetingbank) at `q8` | 182 MB | The export repo declares no license; the upstream weights are Apache-2.0 | The default. Smallest and fastest, and enough for prose in the 104 languages BERT multilingual covers |
| `xlm-roberta-large-int8` | [`atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank`](https://huggingface.co/atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank) at `int8` | 579 MB | MIT | Better compression quality and a declared license, at roughly three times the disk and noticeably slower inference |
| `bert-multilingual-fp32` | Same repo as the default, at `fp32` | 713 MB | The export repo declares no license; the upstream weights are Apache-2.0 | Same model without the quantization loss, when scoring quality matters more than memory |

Checkpoints are **host-shared and step-selected**: the download lives on the
service host and every router that names a key uses the same files, while
the key itself is a property of the step, set per router. A step with no
`model` runs on the default checkpoint.

Files land under `<ROUTERLY_HOME>/models/<repo>/`, in the layout
transformers.js expects. A checkpoint outside the curated list is an
operator-level escape hatch, not a per-router choice, because it writes
files to the host's disk:

| Variable | Effect |
|----------|--------|
| `ROUTERLY_LLMLINGUA_MODEL` | A Hugging Face repo id. Published as an extra `custom` checkpoint and made the host's default |
| `ROUTERLY_LLMLINGUA_DTYPE` | Its dtype, `q8` when unset |

Every surface reports which checkpoint is the default rather than deriving
it, so an override shows up in the dashboard row and in `routerly optimizers
model` as it is.

#### Installing it

```bash
# on the service host
npm install --workspace=packages/service --include=optional   # or: npm i @huggingface/transformers
# restart the service, then
routerly optimizers model --install                      # the default checkpoint
routerly optimizers model --install xlm-roberta-large-int8   # or a named one
routerly optimizers model                                # poll until state: ready
```

The download runs on the service host in the background: `--install` returns
as soon as it has started, and `routerly optimizers model` reports progress.
The dashboard does the same polling inside the llmlingua-2 row, with a
progress bar, so a page refresh mid-download picks the progress back up.

Without `@huggingface/transformers` the install request is refused with
`409`, and both the CLI and the dashboard say the runtime is missing instead
of offering a download.

---

## Languages

Two of the three text-compression steps are language-bound, and the split is
deliberate:

- **`caveman` is the English step.** It works from a hand-written English
  function-word list, so it can only strip what it recognizes. It measures
  the English function-word ratio of the messages first and stays inert
  below roughly 12%, rather than mangling text it cannot read. Its skip
  reason says so, and points at `llmlingua-2`.
- **`llmlingua-2` is the multilingual step.** The model scores tokens in any
  language its encoder covers, so it is the one to enable for non-English
  traffic. It costs a model download and inference time; `caveman` costs
  nothing.

`rtk` (whitespace and repeated blocks), `session-dedup`, `ccr`, `headroom`,
`json-table` and `relevance` are language-agnostic, though `relevance`
scores lexical overlap, so it behaves best on languages that word-segment on
whitespace.

There is no per-language configuration, and none is planned. A pipeline
picks the step that matches its traffic; the steps detect what they can
handle and skip what they cannot.

## Privacy

**Routerly does not record prompts.** The optimizer pipeline reads a
request, rewrites it in memory, and forwards it. No message body is
buffered, persisted, or exposed by any endpoint. The usage log stores token
counts and never message text.

Preview material is synthetic: the sample conversations offered by the
dashboard and by `routerly optimizers preview --fixture` ship with Routerly
and contain nobody's data.

Before 0.4.0 the service kept an in-memory buffer of the last few real
prompts per router and served them to any holder of `optimizers:read`. That
buffer, its route (`GET /api/routers/:id/optimizers/samples`) and its
command (`routerly optimizers samples`) are gone.

## Safety Gate and Fail-Open Guarantee

Every `lossy`-class optimizer's result is additionally checked by a shared
floor-ratio **safety gate** (`gate.ts`) before being accepted: if the
optimized output shrank the token estimate below a floor ratio of the
original (default `0.2`), or shrank it to zero, the result is rejected and
rolled back. The request continues with the pre-optimizer content
untouched. `lossless` optimizers skip the safety gate (they have no lossy
budget to police) but still carry their own `validate()` backstop.
`recoverable` optimizers restore a stashed pre-optimize snapshot on any
`validate()` failure.

Every optimizer call (`optimize`) is wrapped in a try/catch with snapshot
rollback in `core.ts`: an optimizer that throws can never break or alter a
request. The pre-optimize snapshot is restored in place and the pipeline
continues to the next step. This is the fail-open guarantee, covered end to
end by `core.test.ts`.

## Default State

All 8 optimizers ship **disabled**. A new router's `optimizers.steps` is
empty. A router must explicitly enable each optimizer id it wants, in the
order it wants them applied, via its `optimizers.steps` config (see [API:
Optimizers](../api/management.md#optimizers), [CLI: `routerly
optimizers`](../cli/commands.md#routerly-optimizers), or the dashboard's
[Optimizer tab](../dashboard/routers.md#optimizer-tab)). `llmlingua-2`
additionally requires the runtime and a checkpoint described above before it
can ever activate, even when enabled in a router's config.

## Threshold Range

A step's `threshold` means different things depending on the optimizer, and
the management API validates it accordingly:

| Optimizer | Threshold means | Range | Unset |
|-----------|-----------------|-------|-------|
| `ccr` | Recent turns kept verbatim | `1`–`50` turns | Defaults to `3` |
| `headroom` | Tokens reserved for the answer | `0`–`32768` tokens | Defaults to `1024` |
| `json-table` | Minimum rows before an array is compacted | `2`–`500` rows | Defaults to `5` |
| `relevance` | Minimum lexical overlap with the newest turn | `0`–`1` ratio | Defaults to `0.1` |
| `llmlingua-2` | Fraction of tokens kept | `0.05`–`0.95` ratio | Defaults to `0.5` |
| `session-dedup`, `rtk`, `caveman` | Not used | — | — |

Leave threshold unset on any step to use its built-in default.

`llmlingua-2` is the one step that also takes a `model`: the key of the
checkpoint it runs on ([Checkpoints](#checkpoints)). Any other step is
rejected with `400` if a `model` is set on it.

The ranges above are declared once, in the shared optimizer catalog
(`packages/shared/src/types/optimizers.ts`), and read from there by the
dashboard's threshold fields and by `routerly optimizers list`, so every
surface states the same numbers. `catalog.test.ts` keeps the catalog honest
against the optimizers themselves.

## Tuning a Pipeline

A pipeline is worth tuning against traffic that resembles what it will
actually see. Three things exist for that, on every surface:

**Start from a fixture.** Routerly ships four synthetic sample
conversations, each built to exercise a different group of steps. List them
with `routerly optimizers fixtures`, or pick one from the dashboard's
preview box.

| Fixture | What it is | Exercises |
|---------|-----------|-----------|
| `support-chat-en` | A 17-message support thread with a repeated hold message, pasted order details and a duplicated signature | `session-dedup`, `ccr`, `rtk`, `relevance`, `caveman` |
| `agent-tools-en` | A build-and-test session with two JSON tool results, a pasted install log and a repeated status line | `json-table`, `session-dedup`, `rtk`, `ccr` |
| `brief-en` | One long instruction, dense with filler | `caveman`, `llmlingua-2` |
| `long-context-en` | About 36k tokens of pasted gateway logs across 45 turns | `headroom`, previewed against a model whose window is 32k or smaller |

A short invented prompt under-reports what optimizers do, because it lacks
the repetition and history they cut.

**Name a model.** `headroom` needs a context window, which comes from the
model the request names. Preview takes a `model` too, for the same reason:
without one it is skipped in preview exactly as it would be on a request
naming a model Routerly has no window for. The dashboard's preview box has a
model selector; the CLI takes `--model`.

**Read the per-step diff, and the skip reason.** Preview reports the prompt
as each step left it, so a step's change can be compared against the step
before it. The dashboard renders that as a word-level diff per step;
`routerly optimizers preview --json` returns the same messages for
scripting. A step that did nothing reports **why** (`skipReason`): no
context window for the model, no repeated message, text that is not English,
no JSON array long enough, the checkpoint not downloaded.

**Separate a no-op from a rollback.** A step whose `before` equals its
`after` either had nothing to do (and says so in `skipReason`) or produced a
result the safety gate rejected. Preview marks the second case explicitly
(`rolledBack: true`), and the measured savings block counts rollbacks per
optimizer over real traffic. Repeated rollbacks mean the threshold is too
aggressive for this router, not that the optimizer is idle.

Once the pipeline is running, the measured effect per optimizer (calls
changed, tokens removed, cost avoided, rollbacks) is reported in the savings
block of `GET /api/usage?savings=1`, by [`routerly report
savings`](../cli/commands.md#routerly-report-savings), and in the router's
Dashboard tab. Those
numbers are recorded per call as it is served, so they are measurements, not
estimates like the model counterfactual next to them.

## Upgrading from 0.3

A router whose pipeline already lists `headroom` needs no edit, but the
step that never fired now fires. A request that overflows the requested
model's context window will start losing its oldest turns, where before it
was forwarded whole and the provider decided what to do with it.

Check what it did: the step is recorded in the request's trace, and its
effect over a period appears in the savings block (`GET
/api/usage?savings=1`, `routerly report savings`, the router Dashboard
tab). To turn it off, disable the `headroom` step in the router's pipeline
(the Optimizer tab, or `routerly optimizers config <router> --disable
headroom`).

Two defaults also changed: `ccr` keeps 3 recent turns instead of 6, and
`relevance` defaults to an overlap of 0.1 instead of staying inert. A step
carrying an explicit `threshold` is unaffected; a step relying on the
default now trims more.

## Wire-Format Transparency

Optimizers run in the `request.preprocess` pipeline phase and mutate only
`ctx.request`'s fields **in place** (e.g. `ctx.request.messages = ...`),
the same pattern used by guardrail steering injection. `ctx.request` is
never reassigned wholesale. No custom headers are added, removed, or
renamed; no non-standard response fields are introduced. The response path
is entirely untouched by optimizers, the client always receives the
provider's response verbatim.

Because `ctx.request` and `ctx.original` are the same object for both
protocol lanes (`request: body, original: body` at context construction,
see `packages/service/src/modules/reverse-proxy/lanes/openai.ts` and
`anthropic.ts`), an in-place mutation of `ctx.request.messages` is visible
through `ctx.original` as well. The Anthropic lane's upstream-forwarding
code reads `ctx.original` to build the outgoing payload (both for verbatim
passthrough and for the `toChat()` conversion used by non-Anthropic
providers), so **Anthropic-protocol requests benefit from optimizer
mutations exactly like OpenAI-protocol requests**. This was verified
against the reverse-proxy Anthropic lane's context-construction and
upstream-execute code, not assumed.

## Token Estimation

Preview and safety-gate token counts use a cheap `chars / 4` approximation
(`estimateTokens()` in `packages/service/src/modules/optimizers/messages.ts`),
not a real provider tokenizer. Treat before/after/saved numbers as an
approximation of relative reduction, not a provider-exact token count.

## Related

- [Service: Routing Engine, Optimizers and Context Window Fit](../service/routing-engine.md#optimizers-and-context-window-fit)
- [API: Optimizers](../api/management.md#optimizers)
- [CLI: `routerly optimizers`](../cli/commands.md#routerly-optimizers)
- [Dashboard: Routers, Optimizer Tab](../dashboard/routers.md#optimizer-tab)
