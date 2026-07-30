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
