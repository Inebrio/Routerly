---
name: council-of-five
description: Run five independent reasoners on one high-stakes decision and converge. Use when a choice is expensive to reverse and a single opinion is not enough.
---

# Council of five

Five agents reason on the same question independently, then read each other
and converge. Independence is the whole mechanism: five agents given the
same prompt agree trivially and prove nothing, so each gets a different
lens.

## When

Only for decisions that are expensive to reverse: architecture, a data
model, a public contract, a security boundary, a migration, a choice
between two designs the analysis could not settle. Five agents cost five
times one. A decision you can undo in an hour is not worth it.

## The lenses

Each council member gets the same question, the same artifacts, and one of:

1. **Correctness** — does it actually do what is asked, in every branch and
   edge case?
2. **Simplicity** — what is the smallest thing that works, and what here is
   not needed?
3. **Risk** — how does this fail in production, what data can be lost, what
   is the blast radius?
4. **Fit** — does it match what this codebase already does, or does it
   introduce a second way to do the same thing?
5. **Future cost** — who pays for this in six months, at change time and at
   debug time?

## Procedure

**Round 1, blind.** Spawn all five in parallel. Each returns: a verdict, the
three strongest reasons for it, and the strongest argument against its own
position. No member sees another's output.

**Converge.** Count verdicts.
- Four or five agree → adopt it. Record the dissent in one line: it is the
  first thing to check if the decision goes wrong.
- Three or fewer → run round 2.

**Round 2, informed.** Give every member all five round-1 outputs and ask
one question: which position survives, and what would have to be true for
you to be wrong? Members may change their verdict, and changing it on a
good argument is the point, not a failure.

**Converge again.** Four or more agree → adopt. Otherwise stop.

**Cap: two rounds.** A council that has not converged twice will not
converge on the third try: it has found a real trade-off, not a wrong
answer. Escalate to the human with both positions stated fairly, what each
one costs, and which one you would take.

## Output

Write the decision where the work will look for it, in the analysis or the
blueprint: what was decided, on what reasoning, what the dissent said, and
what evidence would overturn it. A decision nobody can find is a decision
that gets made again next week.
