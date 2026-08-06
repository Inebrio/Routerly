---
title: Experiments
sidebar_position: 10
---

# Experiments

An experiment is an A/B test that sits one level above projects. A client
points at the experiment's own token instead of a project token; for every
request the experiment picks one of its **variants**, each variant being an
existing project taken whole, and the rest of the pipeline runs exactly as if
the client had used that project's token.

Because a variant is a whole project, anything a project can express becomes
comparable: two model sets, two routing profiles, two optimizer pipelines, two
guardrail configurations, or the same setup against two providers.

Nothing about the test reaches the wire. No header selects a variant and no
payload field is added, so a client changes only its base URL and key, exactly
as with any other Routerly token. See
[Architecture](./architecture.md).

Experiments are a **module** and ship enabled with the rest of `0.4.0`. With
the module off, every management route answers `403 module_disabled`, the
dashboard hides the section and the CLI prints the command that turns it back
on (`routerly modules enable experiments`). See
[Dashboard: Modules](../dashboard/settings.md#modules-tab).

---

## Life of an experiment

An experiment routes traffic from the moment it exists. There is no start step,
no stop step and no recorded winner: creating it is enough for its token to
serve calls, and deleting it is how it ends.

Every field stays editable for the whole life of the test: name, description,
variants, weights, rotation, sticky key, judge and `minSamplesPerVariant`.
Redesigning a test that already has traffic mixes two different measurements
under one set of numbers, so narrow the metrics window to the period after the
change when the design moved.

Routerly reports the numbers; deciding which arm wins is the operator's call
and lives outside the experiment.

Deleting an experiment removes its tokens with it, so every client still
calling one starts getting `401`. Move those clients to the winning project's
own token first, then delete.

---

## Rotation

The rotation decides which variant serves a given request.

| Rotation | Behaviour |
|----------|-----------|
| `sticky` | The same caller keeps the same variant for the whole conversation, so a multi-turn session is never split across arms. Default. |
| `weighted` | Every request draws a variant independently, with the share of traffic each variant declares. |
| `round-robin` | Requests alternate between variants in order, an even split without randomness. |

`weighted` reads each variant's `weight`. Weights are normalised against their
own sum, so `1` / `1` and `50` / `50` mean the same thing, and a variant with
no weight counts as `1`. A test that sets no weights at all splits evenly.

Sticky assignments and the round-robin cursor live in memory only. A service
restart re-splits the traffic, which costs a little balance and no
correctness; persisting them would mean a config write on every request.

### Sticky key

`sticky` needs to recognise "the same caller" without reading a custom header
or adding a payload field. The `stickyKey` chooses what it keys on:

| Sticky key | What identifies the caller |
|------------|----------------------------|
| `auto` | The standard `user` field when the client sends it, otherwise a stable fingerprint of the conversation prefix combined with IP and user agent. Default. |
| `end-user` | The standard `user` field only. A call that omits it gets a random variant. |
| `conversation` | The conversation itself, so each new thread can land on a different variant. |
| `client` | The calling machine (IP and user agent), so one client always sees one arm. |

The `user` field is the same one usage records store as `endUserId`: it is part
of the OpenAI and Anthropic request schemas, not something Routerly invented.
The derived key is hashed before it is stored.

`auto` combines the conversation prefix with IP and user agent rather than
using either alone: the prefix by itself would put two different people asking
the same first question on the same variant, and IP plus user agent by itself
would pin a whole office to one arm.

---

## Tokens

An experiment owns tokens of the same shape as a project's, `sk-rt-...`,
stored and matched the same way. The proxy compares an incoming bearer against
both sets, so a client cannot tell whether it is calling a project or a test.

The raw value is shown once, at creation, and never again. An experiment can
hold several tokens, which is how one test can be handed to several clients
and one of them revoked later.

What a client gets back:

| Situation | Response |
|-----------|----------|
| Variant resolved | The provider's own response, unaltered |
| Token past its expiry | `401 Token expired` |
| No variant points at an existing project | `503 experiment_misconfigured` |

A variant whose project was deleted is skipped rather than served as an error:
the remaining arms are still a valid, if unbalanced, test. Only when no arm is
left does the call fail.

---

## Measurement

Every call an experiment routes is stamped with its experiment and variant id
on the usage record. The comparison is read straight off the usage log, so
experiments keep no counters of their own and the numbers agree with
[Usage](../dashboard/usage.md) by construction.

Cost and usage stay attributed to the project that served the call. An
experiment does not create a second billing entity; it labels the calls it
routed.

Per variant, the metrics report:

| Metric | Definition |
|--------|------------|
| Calls | Client completion calls the variant served in the window |
| Errors | Calls whose outcome was neither `success` nor `blocked`, with the rate |
| Cost | USD across those calls, and the average per call |
| Tokens | Input and output totals |
| Latency | Average and p95 (nearest-rank, same method the usage route uses) |
| TTFT | Average time to first token, over the streamed calls only |
| Judge score | Mean judge verdict, `0`-`10`, when the judge is on |

Only the client's own calls count. The router's own decision calls, the
guardrail passes and the judge's verdicts are gateway overhead: counting them
would make the cheap variant look expensive for a reason the operator cannot
act on.

### Minimum samples

Each variant declares whether it has `enoughSamples`, that is at least
`minSamplesPerVariant` calls in the window (default `30`). Until every arm
reaches it, the comparison is flagged as not conclusive.

This is a guard against reading noise, not a significance test. Routerly does
not compute p-values; it tells you when a difference is too thinly sampled to
be worth reading at all.

### Time window

Metrics take an explicit ISO window (`from` / `to`), not a period name. Both
are optional: with neither, the whole history of the experiment is measured.

---

## Judge

Optionally, a model reads the answer each variant produced and scores it from
`0` to `10` against the criteria the experiment declares. This is what makes a
quality comparison possible at all, since cost and latency alone cannot tell
you which arm answered better.

The judge is off unless enabled, and sampled, because every judged call is an
extra model call on your own bill.

How it runs:

- In the `finalize` phase, after the response has already left for the client,
  so scoring costs the caller nothing in latency.
- Only on non-streamed answers, and only when the answer has text.
- On a sampled fraction of the experiment's calls (`sampleRate`, `0`-`1` in
  the API; both the dashboard field and the CLI flag take a percentage).
- Judge calls are recorded with their own `judge` call type, which is excluded
  from the client-facing numbers and from the experiment's own metrics.

The criteria are free text, one line each, and go into the judge's prompt. The
question and the answer are passed as delimited data with an explicit
instruction never to follow instructions found inside them, and each is
truncated to keep the judge's own bill bounded.

Verdicts are kept as a running tally per variant (count and score sum), not
one row per judged call: the average is all the comparison needs and a tally
cannot grow without bound. A verdict that carries no readable score is a
missing data point, not a failure: the call is never affected.

---

## Permissions

| Permission | Grants |
|------------|--------|
| `experiments:read` | List experiments, read one, read its metrics |
| `experiments:manage` | Create, edit, delete, manage tokens |

---

## Where it lives

Experiments are stored in `experiments.json` under the Routerly home. See
[Config files](../reference/config-files.md).

---

## Surfaces

- Dashboard: [Experiments](../dashboard/experiments.md)
- CLI: [`routerly experiments`](../cli/commands.md#routerly-experiments)
- API: [Experiments](../api/management.md#experiments)
