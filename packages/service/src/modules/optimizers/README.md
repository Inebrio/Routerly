# Optimizers

Runtime prompt/context optimizers registered into `OPTIMIZER_REGISTRY` (see
`registry.ts` for the `Optimizer` contract and `core.ts` for the
`request.preprocess` pipeline step that applies them).

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
