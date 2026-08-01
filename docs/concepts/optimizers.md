---
title: Optimizers
sidebar_position: 8
---

# Optimizers

Optimizers reduce the token footprint of a request's message array before it
is forwarded to a provider. They run per-project, in a configurable pipeline,
and are **off by default**. A project must explicitly enable each optimizer
id it wants.

Routerly ships 7 built-in optimizers. Each declares a **class** that
determines how strictly its output is checked before being accepted:

| Class | Meaning |
|-------|---------|
| `lossless` | No information is discarded, messages are only deduplicated or trimmed to a fixed budget. Own `validate()` backstop only (skips the safety gate below). |
| `recoverable` | Content is condensed or compacted but a pre-optimize snapshot is kept; a failed `validate()` rolls back to the original. |
| `lossy` | Content is deliberately dropped or compressed. In addition to `validate()`, every `lossy` result is checked by the shared **safety gate** before being accepted. |

---

## The 7 Optimizers

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

Keeps the leading system prefix and the last N turns (default 6, via the
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

Trims the oldest whole turns until the request fits inside the target
model's context window minus a reserved completion headroom (default 1024
tokens, via the step's `threshold`). No re-summarization, that is `ccr`'s
job.

:::caution Known limitation: permanent no-op on live requests today
`headroom`'s context-window source is `ctx.attempt.model.contextWindow`,
which is only populated once the routing engine has resolved a candidate
model. That resolution happens **after** the `request.preprocess` pipeline
phase where all optimizers run (see [Service: Routing
Engine](../service/routing-engine.md#optimizers-and-context-window-fit)).
As a result, `headroom`'s `supports()` check never sees a context window on
a real request today, and the optimizer is a **permanent no-op in
production**, even though its trim logic is correct and fully covered in
isolation by its own tests. This is not a bug in `headroom` itself, it is
the current pipeline phase ordering. Fixing it (re-checking
attempt-dependent optimizers once a candidate is resolved) is a documented
follow-up, not yet scheduled.
:::

### relevance

`id: relevance`, class `lossy`.

Scores each older turn's lexical overlap (Jaccard similarity of lowercase
word sets) against the newest turn and drops whole turns scoring below the
step's `threshold`. Unlike `ccr`/`headroom`, there is no default threshold,
`relevance` stays inert until a project explicitly sets one. The newest
turn is never scored and always kept.

This is a lexical, not semantic, heuristic. It may be upgraded to
embedding-based scoring if lexical overlap proves too blunt in practice;
not built speculatively today.

### caveman

`id: caveman`, class `lossy`.

Clean-room lexical compression: strips a small English filler-word list
(articles, conjunctions, prepositions, pronouns, auxiliaries, hedges) from
each message's own plain text and collapses the resulting whitespace.
Fenced code blocks, inline code spans, URLs, and digit sequences are
preserved verbatim, unconditionally, even under aggressive stripping.
Messages are never dropped, reordered, or merged, and non-text content
parts are never touched.

### llmlingua-2

`id: llmlingua-2`, class `lossy`.

Token-level prompt compression backed by a real, named, third-party ONNX
model: technique from `microsoft/LLMLingua`
(https://github.com/microsoft/LLMLingua, MIT license) with the
`microsoft/llmlingua-2-xlm-roberta-large-meetingbank` checkpoint
(https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank,
MIT license). Each token of a message's own text is scored by the model's
keep/discard head; the lowest-scoring tokens are dropped down to a target
keep-ratio (the step's `threshold`, default `0.5`).

Off by default in two independent ways:
- The `onnxruntime-node` native inference package is declared as an
  **optional dependency** (`packages/service/package.json`), not installed
  by default, and imported lazily inside a try/catch.
- The model checkpoint is never auto-downloaded. It requires explicit
  operator opt-in (`downloadModel(true)`) and lands at a fixed path,
  `<ROUTERLY_HOME>/models/llmlingua-2/model.onnx`. With no checkpoint on
  disk (the default state), the optimizer still self-registers into the
  catalog (so `GET /api/optimizers` lists it) but `supports()` always
  returns `false`, so it is a permanent no-op until an operator opts in.

:::caution Known limitation: tokenization is a placeholder, not production-quality
The token-scoring step that feeds the ONNX inference session does **not**
use the checkpoint's real XLM-RoBERTa SentencePiece tokenization. It uses a
placeholder, hash-based token-id mapping. The ONNX inference session itself
is real and runs the real, MIT-licensed checkpoint, but because the input
token ids do not match the vocabulary the checkpoint was trained on, the
resulting compression ratio and output quality are **not representative of
genuine LLMLingua-2 output**. Do not present this optimizer as
production-quality prompt compression until a real tokenizer (e.g. via
`@huggingface/transformers`) replaces the placeholder. It is off by default
today (see above), so there is no live-traffic risk yet, but this caveat
must travel with any future decision to make it easier to enable.
:::

---

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

All 7 optimizers ship **disabled**. A new project's `optimizers.steps` is
empty. A project must explicitly enable each optimizer id it wants, in the
order it wants them applied, via its `optimizers.steps` config (see [API:
Optimizers](../api/management.md#optimizers), [CLI: `routerly
optimizers`](../cli/commands.md#routerly-optimizers), or the dashboard's
[Optimizer tab](../dashboard/projects.md#optimizer-tab)). `llmlingua-2`
additionally requires the separate model-download opt-in described above
before it can ever activate, even when enabled in a project's config.

## Threshold Range

A step's `threshold` means different things depending on the optimizer, and
the management API validates it accordingly:

| Optimizer | Threshold means | Range | Unset |
|-----------|-----------------|-------|-------|
| `ccr` | Recent turns kept verbatim | `1`–`50` turns | Defaults to `6` |
| `headroom` | Tokens reserved for the answer | `0`–`32768` tokens | Defaults to `1024` |
| `relevance` | Minimum lexical overlap with the newest turn | `0`–`1` ratio | Inert: no default |
| `llmlingua-2` | Fraction of tokens kept | `0.05`–`0.95` ratio | Defaults to `0.5` |
| `session-dedup`, `rtk`, `caveman` | Not used | — | — |

`ccr` and `headroom` accept any positive number; `relevance` and
`llmlingua-2` are capped at `1`. Leave threshold unset on any step to use
its built-in default, except on `relevance`, which does nothing until a
threshold is set.

The ranges above are declared once, in the shared optimizer catalog
(`packages/shared/src/types/optimizers.ts`), and read from there by the
dashboard's threshold fields and by `routerly optimizers list`, so every
surface states the same numbers. `catalog.test.ts` keeps the catalog honest
against the optimizers themselves.

## Tuning a Pipeline

A pipeline is worth tuning against the traffic it will actually see. Three
things exist for that, on every surface:

**Replay a real prompt.** The service keeps the last 5 prompts per project in
memory (at most 20 messages each, clipped at 1000 characters), captured in the
optimizer pipeline, so after PII scrubbing and guardrails. They are never
written to disk and are lost on restart. Read them with `GET
/api/projects/:id/optimizers/samples`, `routerly optimizers samples`, or the
picker above the dashboard's preview box, and run the pipeline over one
instead of a hand-typed sentence. A short invented prompt under-reports what
optimizers do, because it lacks the repetition and history they cut.

**Read the per-step diff.** Preview reports the prompt as each step left it,
so a step's change can be compared against the step before it. The dashboard
renders that as a word-level diff per step; `routerly optimizers preview
--json` returns the same messages for scripting.

**Separate a no-op from a rollback.** A step whose `before` equals its
`after` either had nothing to do or produced a result the safety gate
rejected. Preview marks the second case explicitly (`rolledBack: true`), and
the measured savings block counts rollbacks per optimizer over real traffic.
Repeated rollbacks mean the threshold is too aggressive for this project, not
that the optimizer is idle.

Once the pipeline is running, the measured effect per optimizer (calls
changed, tokens removed, cost avoided, rollbacks) is reported in the savings
block of `GET /api/usage?savings=1` and in the project's Dashboard tab. Those
numbers are recorded per call as it is served, so they are measurements, not
estimates like the model counterfactual next to them.

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
- [API: Optimizers](../api/management.md#optimizers), [Recent Traffic Samples](../api/management.md#recent-traffic-samples)
- [CLI: `routerly optimizers`](../cli/commands.md#routerly-optimizers)
- [Dashboard: Projects, Optimizer Tab](../dashboard/projects.md#optimizer-tab)
